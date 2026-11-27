/**
 * The relations hanging off an article (mentions, topics), in SQL. The rules
 * are in server/utils/articleEdges.ts; every write takes the caller's
 * transaction (`editorialTx`).
 */
import type { Data, Sql, Tx, WriteLog } from "./editorial";
import { newDocId } from "./ids";
import { createRevisionPg } from "./revisionWrites";

export type EdgeRow = { id: string; data: Data };

/** The edges of `type` leaving the article, then (with `bothDirections`)
 * those arriving at it, each by id, as the two Firestore queries read them. */
export async function articleEdgesOfType(
  sql: Sql,
  articleId: string,
  type: string,
  bothDirections: boolean,
  lock = false,
): Promise<EdgeRow[]> {
  const rows = await sql<EdgeRow[]>`
    SELECT id, data FROM edges
    WHERE type = ${type}
      AND (source = ${articleId} ${bothDirections ? sql`OR target = ${articleId}` : sql``})
    ORDER BY (source = ${articleId}) DESC, id
    ${lock ? sql`FOR UPDATE` : sql``}`;
  return rows;
}

/** A new draft relation of `type` from the article to `targetId`. No
 * `references`: what an article says is a claim about the article itself. */
export async function addArticleEdgePg(
  tx: Tx,
  log: WriteLog,
  user: { uid: string },
  articleId: string,
  targetId: string,
  type: string,
): Promise<string> {
  const edgeId = newDocId();
  await createRevisionPg(
    tx,
    log,
    user,
    { collection: "edges", id: edgeId },
    { source: articleId, target: targetId, type },
    { published: false },
  );
  return edgeId;
}
