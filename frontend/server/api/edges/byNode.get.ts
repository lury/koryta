import { requireAdmin } from "~~/server/utils/auth";
import {
  hasPendingRevision,
  publishCandidateRevision,
  type EdgeEndpoints,
} from "~~/server/utils/edgePublication";
import { approvedRevisionId, pageIsPublic } from "~~/shared/model";
import type { Edge, EdgeType, Revision } from "~~/shared/model";
import {
  readEdgesOfNode,
  readNodeDocs,
  readRevisionsOf,
} from "~~/server/db/edgeLists";
import { z } from "zod";

/** One relation as the publish dialog needs to render it: what it says, who is
 * on the other end, and whether it may go live at all. */
export type NodeRelation = {
  id: string;
  type: EdgeType;
  name: string | null;
  /** Which end of the edge the node this was asked about sits on. */
  direction: "outgoing" | "incoming";
  otherId: string;
  otherName: string | null;
  otherPublished: boolean;
  published: boolean;
  /** When a candidacy was, and for what office - which election it belongs
   * to. Every candidacy is named „kandydatura", so without these a page's
   * seven runs read as seven identical rows, and the dialog could not tell two
   * places in one election (see shared/twoPlaces.ts) from two elections. */
  startDate: string | null;
  position: string | null;
  /** Whether a candidacy was in a by-election, a contest of its own that the
   * two-places rule leaves out. */
  byElection: boolean;
  /** The site's parties a candidacy names - its committee's (`party`, which
   * the pipeline leaves out for a coalition's), and the ones PKW says its
   * candidate belonged to or was backed by - which the import adds to the
   * page's. Empty for any other relation. */
  parties: string[];
  /** The revision publishing this relation would approve, when it points at
   * none of its own yet: the newest one it already holds. Null when the edge
   * already has an approved revision, or holds none and will be published on
   * its document alone - a proposal it does not hold is never this. */
  revisionToApprove: string | null;
  /** Whether a revision of this relation is genuinely still awaiting a verdict,
   * as opposed to merely not being pointed at. */
  hasPendingRevision: boolean;
  /** Whether the reviewer may tick this relation, which is what greys the row
   * out when false.
   *
   * This is `otherPublished` alone, deliberately - *not* the whole
   * both-ends-published rule. The page this was asked about is the one the
   * reviewer is publishing, so at the moment the dialog renders it is still a
   * draft and the full rule would grey out every row, including the ones about
   * to become perfectly publishable. By the time the edges are sent it is live,
   * because the dialog publishes the node first.
   *
   * The real rule still holds: /api/edges/publish checks both ends itself, and
   * refuses whatever this said. */
  publishable: boolean;
};

export type NodeRelations = {
  relations: NodeRelation[];
  nodePublished: boolean;
  /** The page's parties as stored: the import's union over its candidacies,
   * which can hold a namesake's (`partiesOnlyFrom` in shared/twoPlaces.ts).
   * Publishing shows them on a page with an approved version; one without
   * goes up with the version publishing approves. */
  nodeParties: string[];
};

/** `candidacyParties`'s reading of one field: the strings in it. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item)
    : [];
}

/** The site's parties a candidacy gives the page it is on, each once. */
function candidacyParties(edge: Record<string, unknown>): string[] {
  if (edge.type !== "election") return [];
  return [
    ...new Set([
      ...strings(edge.party),
      ...strings(edge.member_parties),
      ...strings(edge.backing_parties),
    ]),
  ];
}

const queryValidator = z.object({
  nodeId: z.string().min(1),
});

/** The relations hanging off one node, for the reviewer about to publish it.
 *
 * Admin-only, unlike /api/revisions/byNode: this answers which pages are still
 * drafts, which is not something an anonymous caller has any business
 * enumerating.
 */
export default defineEventHandler(async (event): Promise<NodeRelations> => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  await requireAdmin(event);

  const reads = postgresReads;
  const [edges, node] = await Promise.all([
    reads.edges(query.nodeId),
    reads.node(query.nodeId),
  ]);

  const live = edges.filter((edge) => edge.deleted !== true);
  const endpoints = await reads.endpoints(live);

  // Only the relations a reviewer might act on need their revisions read: one
  // already live, or already pointing at an approved revision, has nothing to
  // settle. Read for the whole batch at once rather than per row.
  const needRevisions = live.filter(
    (edge) => !pageIsPublic(edge) && !approvedRevisionId(edge.revision_id),
  );
  const revisions = await reads.revisions(needRevisions.map((edge) => edge.id));

  const relations = live.map((edge): NodeRelation => {
    const state = endpoints.get(edge.id);
    const outgoing = edge.source === query.nodeId;
    const otherId = outgoing ? edge.target : edge.source;
    const otherName = outgoing
      ? (state?.targetName ?? null)
      : (state?.sourceName ?? null);
    const otherPublished = outgoing
      ? (state?.targetPublished ?? false)
      : (state?.sourcePublished ?? false);

    const candidates = revisions.get(edge.id) ?? [];

    return {
      id: edge.id,
      type: edge.type,
      name: typeof edge.name === "string" && edge.name ? edge.name : null,
      direction: outgoing ? "outgoing" : "incoming",
      otherId,
      otherName,
      otherPublished,
      published: pageIsPublic(edge),
      startDate:
        typeof edge.start_date === "string" && edge.start_date
          ? edge.start_date
          : null,
      position: typeof edge.position === "string" ? edge.position : null,
      byElection: edge.by_election === true,
      parties: candidacyParties(edge as unknown as Record<string, unknown>),
      revisionToApprove:
        publishCandidateRevision(
          candidates,
          edge as unknown as Record<string, unknown>,
        )?.id ?? null,
      hasPendingRevision: hasPendingRevision(candidates),
      // The subject page is the one being published, so only the far end can
      // hold a relation back. A self-edge has no far end, and is therefore
      // never the thing standing in the way.
      publishable: otherId === query.nodeId ? true : otherPublished,
    };
  });

  // Unpublished first, and the ones that are ready before the ones blocked on
  // a draft - the dialog is a work queue, so what needs a decision goes on top.
  // Then by the other end, and the newest first among several with one place:
  // a council member's six runs in one powiat.
  relations.sort((a, b) => {
    if (a.published !== b.published) return a.published ? 1 : -1;
    if (a.publishable !== b.publishable) return a.publishable ? -1 : 1;
    return (
      (a.otherName ?? a.otherId).localeCompare(
        b.otherName ?? b.otherId,
        "pl",
      ) || (b.startDate ?? "").localeCompare(a.startDate ?? "")
    );
  });

  return {
    relations,
    nodePublished: !!node && pageIsPublic(node),
    nodeParties: strings(node?.parties),
  };
});

type EdgeWithId = Edge & { id: string };
type Endpoints = Pick<
  EdgeEndpoints,
  "sourceName" | "targetName" | "sourcePublished" | "targetPublished"
>;

/** What the dialog reads. */
type Reads = {
  edges: (nodeId: string) => Promise<EdgeWithId[]>;
  node: (nodeId: string) => Promise<Record<string, unknown> | undefined>;
  endpoints: (edges: EdgeWithId[]) => Promise<Map<string, Endpoints>>;
  revisions: (
    edgeIds: string[],
  ) => Promise<Map<string, (Revision & { id: string })[]>>;
};

/** The reads on Postgres. */
const postgresReads: Reads = {
  edges: async (nodeId) => (await readEdgesOfNode(nodeId)) as EdgeWithId[],
  node: async (nodeId) => (await readNodeDocs([nodeId])).get(nodeId),
  endpoints: async (edges) => {
    const nodes = await readNodeDocs(
      edges.flatMap((edge) => [edge.source, edge.target]),
    );
    const name = (id: string) => {
      const value = nodes.get(id)?.name;
      return typeof value === "string" ? value : null;
    };
    const published = (id: string) => {
      const doc = nodes.get(id);
      return (
        !!doc &&
        pageIsPublic({ published: doc.published, deleted: doc.deleted })
      );
    };
    return new Map(
      edges.map((edge) => [
        edge.id,
        {
          sourceName: name(edge.source),
          targetName: name(edge.target),
          sourcePublished: published(edge.source),
          targetPublished: published(edge.target),
        },
      ]),
    );
  },
  revisions: async (edgeIds) => {
    const result = new Map<string, (Revision & { id: string })[]>();
    for (const id of edgeIds) result.set(id, []);
    // Thirty at a time and by id within each, the order the `in` queries
    // read them in, so that ties in time sort the same.
    for (let i = 0; i < edgeIds.length; i += 30) {
      for (const revision of await readRevisionsOf(edgeIds.slice(i, i + 30))) {
        const typed = revision as unknown as Revision & { id: string };
        if (typed.node_id) result.get(typed.node_id)?.push(typed);
      }
    }
    const time = (revision: Revision) =>
      typeof revision.update_time === "string"
        ? Date.parse(revision.update_time) || 0
        : 0;
    for (const list of result.values()) list.sort((a, b) => time(b) - time(a));
    return result;
  },
};
