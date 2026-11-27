import { defineEventHandler, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { withDerivedStats } from "~~/server/db/nodes";
import { useDb } from "~~/server/db/client";
import { textArray } from "~~/server/db/textArray";

type Doc = Record<string, unknown>;

/** The pages still waiting for their first review (`revision_id` stored as
 * null), at most 50 in id order, each with its revisions.
 *
 * Drafts by definition, so signed in readers only, and not from a cache:
 * this was a six hour shared entry anybody could fill and anybody could read.
 * Nothing in the app calls it today.
 */
export default defineEventHandler(async (event) => {
  await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const sql = useDb();
  const nodes = await withDerivedStats(
    await sql<{ id: string; data: Doc }[]>`
      SELECT id, data FROM nodes WHERE (data -> 'revision_id') = 'null'::jsonb
      ORDER BY id LIMIT 50`,
  );
  const ids = nodes.map((node) => node.id);
  const revisions = ids.length
    ? await sql<{ id: string; data: Doc }[]>`
        SELECT id, data FROM revisions
        WHERE node_id = ANY(${textArray(ids)}::text[])
          AND jsonb_typeof(data -> 'node_id') = 'string'
        ORDER BY id`
    : [];
  const byNode = new Map<string, Doc[]>(ids.map((id) => [id, []]));
  for (const { id, data } of revisions) {
    byNode.get(data.node_id as string)?.push({ id, ...data });
  }
  return Object.fromEntries(
    nodes.map(({ id, data }) => [
      id,
      { id, ...data, revisions: byNode.get(id) ?? [] },
    ]),
  );
});
