/**
 * The edge writes that are not a revision: the facts a relation was promoted
 * from, and taking a relation off the site. Each takes the caller's
 * transaction (`editorialTx`), so it commits with the revision and the audit
 * row it goes with.
 */
import { recordAuditPg, type Data, type Tx, type WriteLog } from "./editorial";
import { textArray } from "./textArray";

/** Adds `edgeId` to the fact's `promotedEdgeIds` once (`arrayUnion`). */
export async function addPromotedEdge(
  tx: Tx,
  log: WriteLog,
  factId: string,
  edgeId: string,
): Promise<void> {
  const [row] = await tx<{ data: Data }[]>`
    UPDATE extractions SET
      data = jsonb_set(data, '{promotedEdgeIds}',
        CASE WHEN jsonb_typeof(data -> 'promotedEdgeIds') = 'array'
          THEN CASE WHEN data -> 'promotedEdgeIds' @> to_jsonb(ARRAY[${edgeId}::text])
            THEN data -> 'promotedEdgeIds'
            ELSE data -> 'promotedEdgeIds' || to_jsonb(${edgeId}::text) END
          ELSE to_jsonb(ARRAY[${edgeId}::text]) END),
      updated_at = clock_timestamp()
    WHERE id = ${factId} RETURNING data`;
  if (row) log.add("extractions", factId, undefined, row.data);
}

/** Takes `edgeId` out of every fact's `promotedEdgeIds` (`arrayRemove`). */
export async function removePromotedEdge(
  tx: Tx,
  log: WriteLog,
  edgeId: string,
): Promise<void> {
  const rows = await tx<{ id: string; data: Data }[]>`
    UPDATE extractions SET
      data = jsonb_set(data, '{promotedEdgeIds}', coalesce(
        (SELECT jsonb_agg(value ORDER BY ordinality)
         FROM jsonb_array_elements(data -> 'promotedEdgeIds') WITH ORDINALITY
         WHERE value <> to_jsonb(${edgeId}::text)), '[]'::jsonb)),
      updated_at = clock_timestamp()
    WHERE jsonb_typeof(data -> 'promotedEdgeIds') = 'array'
      AND data -> 'promotedEdgeIds' @> to_jsonb(ARRAY[${edgeId}::text])
    RETURNING id, data`;
  for (const row of rows) log.add("extractions", row.id, undefined, row.data);
}

/** Hides the edges `ids`, each audited as an unpublication. The revisions they were published from stay. */
export async function unpublishEdgesPg(
  tx: Tx,
  log: WriteLog,
  ids: string[],
  user: { uid: string },
): Promise<void> {
  if (ids.length === 0) return;
  const before = await tx<{ id: string; data: Data }[]>`
    SELECT id, data FROM edges WHERE id = ANY(${textArray(ids)}::text[])
    ORDER BY id FOR UPDATE`;
  const after = await tx<{ id: string; data: Data }[]>`
    UPDATE edges SET data = data || '{"published": false}'::jsonb,
      updated_at = clock_timestamp()
    WHERE id = ANY(${textArray(ids)}::text[]) RETURNING id, data`;
  const old = new Map(before.map((row) => [row.id, row.data]));
  const now = new Map(after.map((row) => [row.id, row.data]));
  for (const id of ids) {
    log.add("edges", id, old.get(id), now.get(id));
    await recordAuditPg(tx, {
      action: "unpublish",
      collection: "edges",
      target_id: id,
      user: user.uid,
    });
  }
}
