import { nodeTypes, pageIsPublic } from "~~/shared/model";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { dropDraftStats } from "~~/server/utils/fetch";
import { z } from "zod";
import type { Node } from "~~/shared/model";
import { readNodesByIds } from "~~/server/db/nodes";
import {
  MAX_MERGE_HOPS,
  readLatestRevision,
  resolveMergedNodeDoc,
} from "~~/server/db/graph";

const responseValidator = z.object({
  name: z.string(),
  type: z.enum(nodeTypes),
  // TODO revision elements are either string or complex object
  //
  // `null` as well as absent: null is how a page still waiting for its first
  // review is marked, and /api/nodes/pending queries on exactly that. Under
  // `.optional()` every such page threw a ZodError here - a 500 where a 404
  // belonged, and most of production's 5xx in September 2026.
  revision_id: z.union([z.string(), z.object({ path: z.string() })]).nullish(),
  published: z.boolean().optional(),
});

/** One page, as this reader may see it: the newest revision for a signed in
 * reader who asks with `latest`, the stored and published page for anybody
 * else.
 *
 * `editorFresh` rather than the plain six hour cache this had, which held the
 * `latest` answer under its url for anyone who typed it - with the 404 below
 * skipped for any `latest` at all, `latest=false` included. The newest
 * revision of a page nobody has published, parties and all, went to whoever
 * asked; `wantsLatest` now wants a token for it, and the reader it lets
 * through is not served from a cache.
 */
export default editorFreshCachedEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Missing type or id" });
  }
  const latest = await wantsLatest(event);

  const node = await (latest ? latestNode(id) : entity(id));

  if (!node) {
    throw createError({
      statusCode: 404,
      message: `Node not found for id=${id} and latest=${latest}`,
    });
  }
  // Ahead of the shape check rather than after it. Whether a page may be read
  // is `published` and `deleted`, which are there whatever else the document
  // holds, so a page nobody may read is a 404 however it is shaped - not a
  // 500 that tells a crawler to come back and try again.
  if (!pageIsPublic(node) && !latest) {
    throw createError({
      statusCode: 404,
      message: `Page ${id} is not approved`,
    });
  }
  // TODO how to check the response has a correct shape
  responseValidator.parse(node);

  return { node: latest ? node : dropDraftStats(node) };
});

/** The page, or the page it was merged into, with the derived stats laid
 * over the stored ones as everywhere else.
 *
 * A duplicate keeps its document so its url still resolves, but it is
 * `deleted`, so answering with it would 404 every link anybody ever made to
 * it. Answering with the survivor does the redirect for free:
 * `[seoType]/[slug]` compares the url it was asked for against
 * `generateNodeUrl` of what this returns, and sends the reader on. */
async function entity(id: string): Promise<Node | undefined> {
  const { id: survivor, data } = await resolveMergedNodeDoc(id, MAX_MERGE_HOPS);
  if (!data) return undefined;
  const [row] = await readNodesByIds([survivor]);
  if (!row) return undefined;
  // `visibility` is what the lists add; this route never sent it.
  const { visibility: _, ...node } = row;
  return node as unknown as Node;
}

/** The newest revision of the page, its visibility off the stored document:
 * a revision says what the page should say, not who may read it, and
 * `INTERNAL_FIELDS` strips `published` from it on the way in. */
async function latestNode(id: string) {
  const [revision, stored] = await Promise.all([
    readLatestRevision(id),
    entity(id),
  ]);
  if (!revision) return stored;
  return {
    id,
    ...(revision.data as Record<string, unknown>),
    published: stored?.published === true,
  };
}
