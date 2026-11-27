import type {
  Company,
  Edge,
  Node,
  Person,
  Region,
  StoredSearchLines,
} from "~~/shared/model";
import { getEdges, getNodesNoStats, getNodeGroups } from "~~/shared/graph/util";
import { partyColors } from "~~/shared/misc";
import {
  storedSearchLines,
  type LineTarget,
  type LineTargets,
} from "~~/shared/searchLine";
import { writtenByImportOrReviewed } from "~~/server/utils/provenance";

/** `nodeGroupSize` and `searchLine` as the TypeScript recount computed them
 * before the SQL of 0602 and server/db/groupSizes.ts took over: the oracle
 * of statsSql.pg.test.ts. */

/** What the recount and the helpers it calls read of each collection, and
 * nothing else. A node's search chunks and old stats, and the snapshot each
 * revision carries, are most of the bytes and nothing here reads them. A field
 * left off reads as absent and changes the output without an error, so a
 * helper that starts reading another field needs it added here. */
export const RECOUNT_FIELDS = {
  nodes: [
    "type",
    "name",
    "published",
    "deleted",
    "revision_id",
    // Regions: the search line and the region rows.
    "teryt",
    // Places: which posts count.
    "isPublic",
    "supervisoryBody",
    // People: queueTier.
    "wikipedia",
    "rejestrIo",
    // People: the party counts on the home map's powiat rows.
    "parties",
    // getNodeGroups leaves a hidden node out of a group.
    "hide",
  ],
  edges: [
    "type",
    "source",
    "target",
    "published",
    "deleted",
    "revision_id",
    "name",
    "start_date",
    "end_date",
    "position",
    "elected",
    "by_election",
  ],
  notes: ["nodeId", "sources"],
  votes: ["nodeId", "userUid", "updatedAt", "categoryVotes"],
  revisions: ["node_id", "nodeId", "update_time", "update_automatic"],
  // `fact_type` is what `queueTier` files a person by.
  extractions: ["personNodeId", "fact_type"],
} as const;

export type NodeEntry = { id: string; data: Node };

/** The nodes by type, as getNodeGroups and the place sets read them. */
export function nodesByType(nodes: readonly NodeEntry[]) {
  const people: Record<string, Person> = {};
  const places: Record<string, Company> = {};
  const regions: Record<string, Region> = {};
  for (const n of nodes) {
    if (n.data.type === "person") people[n.id] = n.data as Person;
    else if (n.data.type === "place") places[n.id] = n.data as Company;
    else if (n.data.type === "region") regions[n.id] = n.data as Region;
  }
  return { people, places, regions };
}

/** `stats.nodeGroupSize`: the people each person, place and region reaches
 * by the graph's traverse rules. */
export function nodeGroupSizes(
  byType: ReturnType<typeof nodesByType>,
  edges: Edge[],
): Record<string, number> {
  const { people, places, regions } = byType;
  const nodesNoStats = getNodesNoStats(people, places, regions, partyColors);
  const groups = getNodeGroups(
    nodesNoStats,
    getEdges(edges),
    people,
    places,
    regions,
  );
  const sizes: Record<string, number> = {};
  for (const group of groups) sizes[group.id] = group.stats.people;
  return sizes;
}

/** The first revision of every document, which is what says whether an
 * import wrote it - the rule the teaser route reads it by, one query per
 * document, kept here in one pass (server/utils/provenance.ts). */
export type FirstRevisions = Record<
  string,
  { at: string; update_automatic?: unknown }
>;

export function addFirstRevision(
  firsts: FirstRevisions,
  id: string | undefined | null,
  at: string | null,
  updateAutomatic: unknown,
): void {
  if (!id || at === null) return;
  const first = firsts[id];
  if (!first || at < first.at) {
    firsts[id] = { at, update_automatic: updateAutomatic };
  }
}

/** `stats.searchLine` of a person, given every node and live edge. */
export function searchLineReader(
  nodesRecord: Record<string, Node>,
  edges: readonly Edge[],
  firstRevisions: FirstRevisions,
  now: number,
): (node: NodeEntry, nodeEdges: Edge[]) => StoredSearchLines {
  // What the search line reads of a company besides its name: the region its
  // `seat` edge comes from and the regions that own it, for a town where the
  // name carries none (shared/searchLine.ts).
  const seatOf: Record<string, string> = {};
  const ownersOf: Record<string, string[]> = {};
  for (const edge of edges) {
    if (edge.deleted === true || !edge.source || !edge.target) continue;
    if (nodesRecord[edge.source]?.type !== "region") continue;
    if (edge.type === "seat") seatOf[edge.target] ??= edge.source;
    else if (edge.type === "owns")
      (ownersOf[edge.target] ??= []).push(edge.source);
  }
  const lineTargets: LineTargets = {
    get: (id) => {
      const node = nodesRecord[id];
      if (!node) return undefined;
      if (node.type !== "place") return node as LineTarget;
      return {
        ...(node as LineTarget),
        seat: seatOf[id],
        owners: ownersOf[id] ?? [],
      };
    },
  };
  const shownOnTeaser = (doc: { id: string; revision_id?: unknown }) =>
    writtenByImportOrReviewed(doc, firstRevisions[doc.id]);
  return (node, nodeEdges) =>
    storedSearchLines(
      {
        id: node.id,
        revision_id: node.data.revision_id,
        published: node.data.published,
        deleted: node.data.deleted,
      },
      nodeEdges.filter((edge): edge is Edge & { id: string } => !!edge.id),
      lineTargets,
      shownOnTeaser,
      now,
    );
}
