/** The captured pages (`articlePages`) of POST /api/ingest/page. */
import { useDb } from "./client";
import { storable, type Data, type Tx, type WriteLog } from "./editorial";
import { newDocId } from "./ids";
import type { StoredDoc } from "./ingestWrites";

/** The captures of one url with the same bytes, at most 20, by id
 * (`article_pages_data`). */
export async function capturesOfPg(
  normalizedUrl: string,
  htmlSha256: string,
): Promise<StoredDoc[]> {
  const sql = useDb();
  return sql<StoredDoc[]>`
    SELECT id, data FROM article_pages
    WHERE data @> ${sql.json({ normalizedUrl, htmlSha256 })}
    ORDER BY id LIMIT 20`;
}

/** Files a capture under a new id, in the caller's transaction. */
export async function addCapturePg(
  tx: Tx,
  log: WriteLog,
  page: Data,
): Promise<string> {
  const id = newDocId();
  const data = storable("articlePages", id, page);
  await tx`INSERT INTO article_pages (id, data) VALUES (${id}, ${tx.json(data as never)})`;
  log.add("articlePages", id, undefined, data);
  return id;
}

/** Marks a capture whose extraction could not be dispatched. */
export async function failCapturePg(id: string, error: string): Promise<void> {
  const sql = useDb();
  await sql`
    UPDATE article_pages SET
      data = jsonb_set(
        data || jsonb_build_object('status', 'error', 'updatedAt', ${new Date().toISOString()}::text),
        '{extraction}',
        (CASE WHEN jsonb_typeof(data -> 'extraction') = 'object' THEN data -> 'extraction' ELSE '{}'::jsonb END)
          || jsonb_build_object('error', ${error}::text)),
      updated_at = clock_timestamp()
    WHERE id = ${id}`;
}
