import { textArray } from "./textArray";
import { createError } from "h3";
import { useDb } from "./client";
import { newDocId } from "./ids";
import {
  commentDocumentSchema,
  feedbackDocumentSchema,
} from "../../shared/documents";
import type { Comment, Feedback } from "../../shared/model";
import { OPEN_STATUSES, SETTLED_STATUSES } from "../../shared/feedbackQueue";

/** Comments and feedback on Postgres: the same queries the Firestore
 * handlers make, one for one. */

export async function addCommentPg(
  comment: Omit<Comment, "id">,
): Promise<string> {
  const id = newDocId();
  commentDocumentSchema.parse(comment);
  await useDb()`
    INSERT INTO comments (id, data) VALUES (${id}, ${useDb().json(comment as never)})`;
  return id;
}

/** `where(field, "==", value)` on nodeId/edgeId, or both null for the leads;
 * at most 50, oldest first. Firestore's `limit(50)` without an order took
 * the first 50 by id, and so does this. */
export async function listCommentsPg(
  filter: { onlyLeads: true } | { nodeId: string } | { edgeId: string },
): Promise<Comment[]> {
  const sql = useDb();
  const where =
    "onlyLeads" in filter
      ? sql`data -> 'nodeId' = 'null'::jsonb AND data -> 'edgeId' = 'null'::jsonb`
      : "nodeId" in filter
        ? sql`(data ->> 'nodeId') COLLATE "C" = ${filter.nodeId}`
        : sql`(data ->> 'edgeId') COLLATE "C" = ${filter.edgeId}`;
  const rows = await sql<{ id: string; data: Comment }[]>`
    SELECT id, data FROM comments WHERE ${where} ORDER BY id LIMIT 50`;
  return rows.map(({ id, data }) => ({ ...data, id }));
}

const DAILY_SLACK_CAP = 500;

/** The day's count of reports, bumped; whether this one may still go to
 * Slack. `UPDATE … RETURNING` in place of the Firestore transaction. */
export async function slackForwardAllowedPg(day: string): Promise<boolean> {
  const sql = useDb();
  const [row] = await sql<{ count: number }[]>`
    INSERT INTO feedback_limits (id, data)
    VALUES (${day}, jsonb_build_object('count', 1, 'day', ${day}::text))
    ON CONFLICT (id) DO UPDATE SET
      data = feedback_limits.data || jsonb_build_object('count',
        coalesce((feedback_limits.data ->> 'count')::int, 0) + 1),
      updated_at = now()
    RETURNING (data ->> 'count')::int AS count`;
  return row!.count - 1 < DAILY_SLACK_CAP;
}

export async function addFeedbackPg(doc: Feedback): Promise<string> {
  const id = newDocId();
  feedbackDocumentSchema.parse(doc);
  await useDb()`
    INSERT INTO feedback (id, data) VALUES (${id}, ${useDb().json(doc as never)})`;
  return id;
}

/** GET /api/feedback/list: open reports up to `openCap + 1` in id order (the
 * Firestore query had no order), the newest `limit` settled ones, and one
 * report by id. */
export async function listFeedbackPg(options: {
  openCap: number;
  limit: number;
  include?: string;
}): Promise<{
  open: Feedback[];
  settled: Feedback[];
  included: Feedback | null;
}> {
  const sql = useDb();
  const toFeedback = (r: { id: string; data: Feedback }) => ({
    ...r.data,
    id: r.id,
  });
  const [open, settled, included] = await Promise.all([
    sql<{ id: string; data: Feedback }[]>`
      SELECT id, data FROM feedback
      WHERE data ->> 'adminStatus' = ANY(${textArray([...OPEN_STATUSES])}::text[])
      ORDER BY id LIMIT ${options.openCap + 1}`,
    sql<{ id: string; data: Feedback }[]>`
      SELECT id, data FROM feedback
      WHERE data ->> 'adminStatus' = ANY(${textArray([...SETTLED_STATUSES])}::text[])
      ORDER BY (data ->> 'createdAt') COLLATE "C" DESC, id DESC
      LIMIT ${options.limit}`,
    options.include
      ? sql<{ id: string; data: Feedback }[]>`
          SELECT id, data FROM feedback WHERE id = ${options.include}`
      : Promise.resolve([]),
  ]);
  return {
    open: open.map(toFeedback),
    settled: settled.map(toFeedback),
    included: included[0] ? toFeedback(included[0]) : null,
  };
}

/** Admin triage: only the fields sent, the renumbered reports in the same
 * transaction; a renumbered report that is gone fails the whole of it. */
export async function triageFeedbackPg(
  id: string,
  patch: Record<string, unknown>,
  removeRank: boolean,
  renumber: { id: string; queueRank: number }[],
): Promise<boolean> {
  return useDb().begin(async (tx) => {
    const [found] =
      await tx`SELECT 1 FROM feedback WHERE id = ${id} FOR UPDATE`;
    if (!found) return false;
    for (const row of renumber) {
      const updated = await tx`
        UPDATE feedback SET data = data || jsonb_build_object('queueRank', ${row.queueRank}::float8),
          updated_at = now()
        WHERE id = ${row.id}`;
      if (updated.count === 0) {
        throw createError({
          statusCode: 404,
          message: "Zgłoszenie z kolejki nie istnieje.",
        });
      }
    }
    if (Object.keys(patch).length > 0 || removeRank) {
      await tx`
        UPDATE feedback SET
          data = (data ${removeRank ? tx`- 'queueRank'` : tx``}) || ${tx.json(patch as never)}::jsonb,
          updated_at = now()
        WHERE id = ${id}`;
    }
    return true;
  });
}
