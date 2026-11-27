import { z } from "zod";
import {
  dropDraftStats,
  fetchNodes,
  fetchOptionsValidator,
} from "~~/server/utils/fetch";
import { matchedTargets } from "~~/server/utils/nodeFilters";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { getUser } from "~~/server/utils/auth";
import { nodeTypes } from "~~/shared/model";
import { defineEventHandler } from "h3";
import { logger } from "firebase-functions/logger";
import { listNodes, placeNamesFromDb } from "~~/server/db/nodes";

const queryValidator = z.object({
  // We use generic fetch options for pagination
  ...fetchOptionsValidator.shape,

  type: z.enum(nodeTypes).optional(),
  // TODO: remove party in the future
  party: z.string().optional(),
  parties: z.union([z.string(), z.array(z.string())]).optional(),
  teryt: z.string().optional(),
  companyTeryt: z.string().optional(),
  krs: z.union([z.string(), z.array(z.string())]).optional(),
  place: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.string().optional(),
  visibility: z.enum(["public", "private"]).optional(),
  hideVoted: z.enum(["all", "no_votes", "has_votes"]).optional(),
  currentlyEmployed: z.enum(["all", "any", "selected"]).optional(),
  minEmploymentDate: z.string().optional(),
  minVotes: z.coerce.number().optional(),
  queueTier: z.coerce.number().optional(),
  election: z.union([z.string(), z.array(z.string())]).optional(),
  electionResult: z.enum(["won", "lost"]).optional(),
  /** One page by its id, as a row like any other: what /eksploruj/nowe asks
   * for when its url names somebody the queue has moved past. */
  id: z.string().min(1).optional(),
  /** Pages by id, fifty at most: the places a table's filter names. */
  ids: z
    .union([z.string(), z.array(z.string()).max(50)])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : Array.isArray(value) ? value : [value],
    ),

  // Sorting parameters
  sortBy: z.string().optional(),
  sortDesc: z.enum(["true", "false"]).optional(),
});

export type Query = z.infer<typeof queryValidator>;

// We wrap the original logic in a cached handler to preserve the caching
// for endpoints that rely on the old behavior (e.g. useEntities).
//
// `editorFresh`, and both layers of cache have to give way for it to mean
// anything: the response cache here, and `fetchNodes`'s own hour-long one
// underneath. An editor who has just created a topic asks this endpoint for the
// list to pick it from, and was handed a list from before they made it.
const cachedHandler = editorFreshCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );
  const latest = await wantsLatest(event);

  const opts = {
    personParties: query.parties || query.party,
    bypassCache: latest,
  };

  // The typeless caller is rejected before we get here, so there is always a
  // type to fetch.
  const nodes = await fetchNodes(query.type!, opts);
  return { nodes: latest ? nodes : publicNodes(nodes) };
});

/** The pages anybody may read, as anybody may read them.
 *
 * This answered every caller with the whole collection and left it to the
 * client to hide the drafts: on 2026-10-14 `?type=person` handed a logged out
 * curl 11.4 MB, 10,904 people of whom 9,653 were unpublished and 2,657 carried
 * a party. `useEntitiesFiltering` drops the same pages in the browser, so the
 * public page draws what it always drew. Filtered here, after `fetchNodes`,
 * rather than in its query, so that its one cache entry per type goes on
 * serving both kinds of reader.
 */
function publicNodes<N extends { visibility?: boolean }>(
  nodes: Record<string, N>,
): Record<string, N> {
  return Object.fromEntries(
    Object.entries(nodes)
      .filter(([, node]) => node.visibility === true)
      .map(([id, node]) => [id, dropDraftStats(node)]),
  );
}

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  // Without a type this merges all four collections into one ~16 MB response.
  // Cloud CDN will not store anything over 10 MiB, so it can never be cached
  // and every caller pays full origin egress for the entire database.
  //
  // Nothing in the app asks for it that way - every caller sets a type
  // (app/composables/entity.ts, app/components/form/EntityPicker.vue) or goes
  // through the paginated path below (app/composables/entity/listWithStats.ts).
  // Logged rather than silently rejected so that a caller we have not accounted
  // for shows up somewhere we will see it.
  if (!query.type) {
    logger.warn("[api/nodes] rejected typeless request", {
      referer: getRequestHeader(event, "referer"),
      userAgent: getRequestHeader(event, "user-agent"),
    });
    throw createError({ statusCode: 400, message: "Missing type" });
  }

  // A page, a count or a sort: every filter and the order in SQL, never more
  // than NODE_PAGE_LIMIT rows.
  if (query.limit || query.sortBy) {
    const user = await getUser(event).catch(() => null);
    return listFromPostgres(
      {
        ...query,
        limit: Math.min(query.limit ?? NODE_PAGE_LIMIT, NODE_PAGE_LIMIT),
      },
      !!user,
    );
  }

  // The whole of a type only where the type is bounded by something other
  // than the base: the TERYT units, the topics editors name. A person, place
  // or article list grows with the base, and at x50 `?type=place` ran the
  // server out of heap.
  if (!WHOLE_TYPES.includes(query.type)) {
    throw createError({
      statusCode: 400,
      message: `List ${query.type} a page at a time: pass limit (at most ${NODE_PAGE_LIMIT})`,
    });
  }
  return cachedHandler(event);
});

/** The most rows one page of /api/nodes holds; a larger `limit` is cut to
 * it. The largest page the site asks for is /eksploruj/autograf's 200. */
export const NODE_PAGE_LIMIT = 200;

/** The types /api/nodes hands out whole, without `limit`. */
const WHOLE_TYPES: readonly string[] = ["region", "topic"];

/** The paginated list: every filter and the sort in SQL (`listNodes`), and
 * `total` counts what the page is cut from. A reader who may not see drafts
 * gets published pages only, and not their unpublished relations
 * (`dropDraftStats`). Beside a company or region filter, which employers and
 * regions put each row here (`matched`) and the names of the companies among
 * them, so the table can mark them. */
async function listFromPostgres(query: Query, signedIn: boolean) {
  const list = await listNodes(query, signedIn);
  if (list === "empty") return { nodes: {}, total: 0 };
  const nodes: Record<string, unknown> = {};
  for (const node of list.rows) {
    nodes[node.id] = signedIn ? node : dropDraftStats(node);
  }
  if (!list.targetIds) return { nodes, total: list.total };
  const matched = matchedTargets(
    list.rows,
    list.targetIds,
    signedIn ? "all" : "approved",
    query.currentlyEmployed,
  );
  return {
    nodes,
    total: list.total,
    matched,
    matchedPlaces: await placeNamesFromDb(
      Object.values(matched).flat(),
      signedIn,
    ),
  };
}
