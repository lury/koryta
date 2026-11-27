/**
 * An article's node, found by its url or created, in SQL (the rules of
 * `ensureArticleNode`, which it replaces). The write takes the caller's transaction
 * (`editorialTx`).
 */
import type { Article } from "../../shared/model";
import { normalizeUrl } from "../../shared/url";
import type { Sql, Tx, WriteLog } from "./editorial";
import { newDocId } from "./ids";
import { createRevisionPg } from "./revisionWrites";

/** The article node for a url, if one is stored: the exact `sourceURL`
 * first (`nodes_article_url`), else any article whose url normalises to the
 * same (`findArticleNodeId`). The lowest id wins either way. */
export async function findArticleNodeIdPg(
  sql: Sql,
  url: string,
): Promise<string | undefined> {
  const [exact] = await sql<{ id: string }[]>`
    SELECT id FROM nodes
    WHERE type = 'article' AND jsonb_text(data -> 'sourceURL') = ${url}
    ORDER BY id LIMIT 1`;
  if (exact) return exact.id;
  const wanted = normalizeUrl(url);
  const all = await sql<{ id: string; url: string | null }[]>`
    SELECT id, jsonb_text(data -> 'sourceURL') AS url FROM nodes
    WHERE type = 'article' ORDER BY id`;
  return all.find((row) => row.url && normalizeUrl(row.url) === wanted)?.id;
}

/** An article's date as stored: the ISO instant of `value`, undefined when
 * there is none or it does not parse (`parseArticleDate`). */
function articleDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    console.error("Invalid date string:", value);
    return undefined;
  }
  return date.toISOString();
}

/** The article node for a url, created approved and live when there is none
 * (`ensureArticleNode`). */
export async function ensureArticleNodePg(
  tx: Tx,
  log: WriteLog,
  user: { uid: string },
  article: {
    url: string;
    name: string;
    publishedDate?: string;
    meta?: unknown;
  },
): Promise<{ nodeId: string; created: boolean }> {
  const existing = await findArticleNodeIdPg(tx, article.url);
  if (existing) return { nodeId: existing, created: false };

  const nodeId = newDocId();
  const revisionData = {
    name: article.name,
    type: "article",
    sourceURL: article.url,
    meta: article.meta,
    // Fallback date, because /zrodla sorts on it.
    publishedDate:
      articleDate(article.publishedDate) ?? new Date().toISOString(),
  } satisfies Partial<Omit<Article, "publishedDate">> & {
    publishedDate: string;
  };
  await createRevisionPg(
    tx,
    log,
    user,
    { collection: "nodes", id: nodeId },
    revisionData,
    // TODO don't autoapprove
    { approve: true, published: true },
  );
  return { nodeId, created: true };
}
