import { pageIsPublic } from "~~/shared/model";
import type { Edge } from "~~/shared/model";
import {
  readEdgesCiting,
  readEdgesOfType,
  readEdgesTo,
  readEdgesTouchingAny,
  readNodeDocsOfType,
} from "~~/server/db/graph";
/** Articles taken at a time. Each chunk's edges are kept in the order they
 * came, chunk after chunk: the order the graphs below were drawn in when the
 * reads were chunked queries. */
const ANY_CHUNK = 30;

/** The articles tagged into a story.
 *
 * `tagged` edges point article → topic, so this is one equality query. Drafts
 * are included for a signed in caller, which is what lets somebody see the
 * story they are still assembling; for everyone else only what a reviewer has
 * approved.
 */
export async function articleIdsForTopic(
  topicId: string,
  includeDrafts: boolean,
): Promise<string[]> {
  const docs: TopicRow[] = await readEdgesTo(topicId, "tagged");

  const ids = new Set<string>();
  for (const data of docs) {
    if (data.deleted === true) continue;
    if (!includeDrafts && !pageIsPublic(data)) continue;
    if (typeof data.source === "string") ids.add(data.source);
  }
  return Array.from(ids);
}

/** Every relation citing any of these articles.
 *
 * This is the step that turns a pile of articles into a graph: an article is
 * not itself a connection between people, it is the evidence for one, and
 * `Edge.references` is where that evidence is recorded. Merged by edge id.
 */
export async function edgesCitingArticles(
  articleIds: string[],
  includeDrafts: boolean,
): Promise<(Edge & { id: string })[]> {
  if (articleIds.length === 0) return [];
  const cited = await readEdgesCiting(articleIds);

  const found = new Map<string, Edge & { id: string }>();
  for (let i = 0; i < articleIds.length; i += ANY_CHUNK) {
    const chunk = articleIds.slice(i, i + ANY_CHUNK);
    const docs = cited
      .filter((edge) =>
        (edge.references as unknown[]).some((ref) =>
          chunk.includes(ref as string),
        ),
      )
      .map((edge) => ({ id: edge.id, data: edge as unknown as Edge }));

    for (const { id, data } of docs) {
      if (found.has(id)) continue;
      if (data.deleted === true) continue;
      if (!includeDrafts && !pageIsPublic(data)) continue;
      found.set(id, { ...data, id });
    }
  }
  return Array.from(found.values());
}

/** Who these articles name.
 *
 * `mentions` is stored with the article at either end - the article page and
 * `useEdgeTypes.ts` write article -> person, `ingest/person.post.ts` writes
 * person -> article - so both directions are asked for and the far end is
 * whichever one is not an article we asked about.
 *
 * The edges themselves are not returned. An article is not drawn in these
 * graphs, so an edge with one end on it has nowhere to land; what it
 * contributes is the person, who belongs in the story whether or not anybody
 * has yet drawn a relation from them.
 */
export async function nodesMentionedByArticles(
  articleIds: string[],
  includeDrafts: boolean,
): Promise<string[]> {
  if (articleIds.length === 0) return [];

  const articles = new Set(articleIds);
  const found = new Set<string>();
  const keep = (data: Edge) => {
    if (data.type !== "mentions") return;
    if (data.deleted === true) return;
    if (!includeDrafts && !pageIsPublic(data)) return;
    const far = articles.has(data.source) ? data.target : data.source;
    if (typeof far === "string" && !articles.has(far)) found.add(far);
  };
  const touching = await readEdgesTouchingAny(articleIds, "mentions");
  for (let i = 0; i < articleIds.length; i += ANY_CHUNK) {
    const chunk = articleIds.slice(i, i + ANY_CHUNK);
    // The edges leaving the chunk, then those arriving.
    for (const end of ["source", "target"] as const)
      for (const edge of touching)
        if (chunk.includes(edge[end] as string)) keep(edge as unknown as Edge);
  }
  return Array.from(found);
}

/** A topic or a `tagged` edge: its document with its id. */
export type TopicRow = {
  id: string;
  published?: unknown;
  deleted?: unknown;
  [field: string]: unknown;
};

/** Every topic and every `tagged` edge, each by id: what /api/topics and
 * /api/articles/topics fold into their lists. */
export async function topicsAndTags(): Promise<{
  topics: TopicRow[];
  tagged: TopicRow[];
}> {
  const [topics, tagged] = await Promise.all([
    readNodeDocsOfType("topic"),
    readEdgesOfType("tagged"),
  ]);
  return { topics, tagged };
}
