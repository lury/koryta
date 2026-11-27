import {
  type NodeType,
  type Edge,
  type Person,
  type Company,
  type Article,
  type Region,
  type Topic,
  pageIsPublic,
} from "~~/shared/model";
import { candidacyDay } from "~~/shared/electionDays";
import { z } from "zod";
import { readNodesByIds, readNodesOfType } from "~~/server/db/nodes";
import { readAllEdges, readEdgesTouching } from "~~/server/db/edges";

/** Positive whole numbers only: `limit=-1`, which is what Vuetify's "all
 * rows" option asks for, is a 400 rather than a 500. */
export const fetchOptionsValidator = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export type FetchOptions = z.infer<typeof fetchOptionsValidator>;

/** A page as an OFFSET and a LIMIT: no limit means the whole list. A
 * route that validates its query with a schema of its own still gets a 400
 * for a page that is not a positive whole number. */
export function pageOf(options: FetchOptions): {
  offset: number;
  limit: number | undefined;
} {
  if (!options.limit) return { offset: 0, limit: undefined };
  const page = options.page || 1;
  if (!isPositiveInteger(options.limit) || !isPositiveInteger(page)) {
    throw createError({
      statusCode: 400,
      message: "limit i page muszą być dodatnimi liczbami całkowitymi.",
    });
  }
  return { offset: (page - 1) * options.limit, limit: options.limit };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

interface nodeData {
  person: Person;
  place: Company;
  article: Article;
  region: Region;
  topic: Topic;
}

export type NodeDataUnion = nodeData[keyof nodeData];

export interface FetchNodesOptions {
  nodeId?: string;
  personParties?: string | string[];
  bypassCache?: boolean;
}

/** How many ids a stored list holds, read tolerantly: a list written from
 * inside another came over from Firestore as a map with numbered keys. */
function idCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

/** A node document as somebody who may not see drafts is to be shown it: its
 * `stats.edges.all` taken off. Returns a copy; `data` is left as it was, since
 * it can be an entry of `fetchNodes`'s cache.
 *
 * `all` is `approved` with the unpublished relations counted in, and its
 * `targetNodeIds` names what they point at - the company of an employment
 * nobody has reviewed, the region a candidacy was in. A reader who may not see
 * a relation may not see where it leads either, and a published page carries
 * `all` as much as a draft does.
 *
 * One number survives it, as `hiddenTargets`: how many more there are, which
 * is what the logged-out table says to invite a sign-in ("W tym widoku
 * znaleźliśmy jeszcze...") and all it ever read `all` for. A count says that
 * there is more without saying what.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dropDraftStats<T extends Record<string, any>>(data: T): T {
  const edges = data.stats?.edges;
  if (!edges || typeof edges !== "object" || !("all" in edges)) return data;
  const { all, ...rest } = edges;
  const hiddenTargets = Math.max(
    0,
    idCount(all?.targetNodeIds) - idCount(rest.approved?.targetNodeIds),
  );
  return {
    ...data,
    stats: { ...data.stats, edges: { ...rest, hiddenTargets } },
  };
}

export async function fetchNodes<N extends NodeType>(
  path: N,
  options: FetchNodesOptions = {},
): Promise<Record<string, nodeData[N]>> {
  return (await _cachedFetchNodes(path, options)) as unknown as Record<
    string,
    nodeData[N]
  >;
}

// Every node of a type, merged-away pages left out, or the one asked for by
// id (`readNodesOfType`), for an hour.
const _cachedFetchNodes = defineCachedFunction(
  async (path: string, options: FetchNodesOptions = {}) =>
    readNodesOfType(path, options),
  {
    maxAge: 3600, // 1 hour
    name: "fetchNodes",
    getKey: (path: string, options?: FetchNodesOptions) => {
      const p = options?.personParties
        ? Array.isArray(options.personParties)
          ? options.personParties.join(",")
          : options.personParties
        : "all";
      return `${path}-${options?.nodeId || "all"}-${p}`;
    },
    shouldBypassCache: (path: string, options?: FetchNodesOptions) =>
      !!options?.bypassCache,
  },
);

/** An edge document as the site hands it out. */
export function edgeFromData(
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>,
): Edge {
  // A candidacy is stored under its election's year; the page shows the day.
  if (data.type === "election") {
    if (typeof data.start_date === "string" && data.start_date) {
      data.start_date = candidacyDay(
        data.start_date,
        data.position,
        data.by_election,
      );
    }
    data["end_date"] = data["start_date"];
  }

  return {
    id,
    ...data,
    content: data.content || data.text || "",
    references: data.references || [],
    visibility: pageIsPublic(data),
  } as Edge;
}

/** The edges with any of `centerNodeIds` at either end. */
export async function fetchEdgesClose(
  centerNodeIds: string | string[],
): Promise<Edge[]> {
  const ids = Array.isArray(centerNodeIds) ? centerNodeIds : [centerNodeIds];
  if (ids.length === 0) return [];
  return (await readEdgesTouching(ids)).map((e) => edgeFromData(e.id, e.data));
}

export async function fetchEdges(): Promise<Edge[]> {
  return (await readAllEdges()).map((e) => edgeFromData(e.id, e.data));
}

export async function fetchNodesByIds(
  nodeIds: string[],
): Promise<NodeDataUnion[]> {
  if (nodeIds.length === 0) return [];
  return (await readNodesByIds(nodeIds)) as unknown as NodeDataUnion[];
}
