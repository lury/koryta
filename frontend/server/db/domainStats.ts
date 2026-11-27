import { useDb } from "./client";

/** The per-domain article counts /api/stats/compute writes (`stats`
 * documents of type `domain_articles`), each replaced whole, in one
 * statement. */
export async function writeDomainArticleStatsPg(
  rows: { id: string; data: Record<string, unknown> }[],
): Promise<void> {
  if (rows.length === 0) return;
  const sql = useDb();
  await sql`
    INSERT INTO stats (id, data)
    SELECT x.id, x.data
    FROM jsonb_to_recordset(${sql.json(rows as never)}) AS x(id text, data jsonb)
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
}
