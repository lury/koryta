/** POST /api/ingest/extraction on Postgres: the article nodes and people a
 * batch of facts is matched against, and the facts written with the recount
 * of every person they name, in one transaction. */
import { useDb } from "./client";
import { editorialTx, storable } from "./editorial";
import { newDocId } from "./ids";
import { textArray } from "./textArray";

/** Every article node with a `sourceURL`. */
export async function articleUrlsPg(): Promise<
  { id: string; sourceURL: string }[]
> {
  return useDb()<{ id: string; sourceURL: string }[]>`
    SELECT id, jsonb_text(data -> 'sourceURL') AS "sourceURL" FROM nodes
    WHERE type = 'article' AND jsonb_text(data -> 'sourceURL') IS NOT NULL`;
}

/** The person nodes among `ids` that have a name, by id. Anything else (an
 * institution, a missing id) is absent: a fact linked to it would be worse
 * than one linked to nobody. */
export async function peopleByIdPg(
  ids: string[],
): Promise<Map<string, { id: string; name: string }>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await useDb()<{ id: string; name: string }[]>`
    SELECT id, jsonb_text(data -> 'name') AS name FROM nodes
    WHERE id = ANY(${textArray(unique)}::text[]) AND type = 'person'
      AND jsonb_text(data -> 'name') IS NOT NULL`;
  return new Map(rows.map((row) => [row.id, row]));
}

/** Stores the facts under new ids and sets `stats.factsCount` on every
 * existing person they name to the count of that person's facts. The number
 * of people updated. */
export async function insertFactsPg(
  facts: Record<string, unknown>[],
): Promise<number> {
  if (facts.length === 0) return 0;
  const rows = facts.map((fact) => {
    const id = newDocId();
    return { id, data: storable("extractions", id, fact) };
  });
  return editorialTx(async (tx, log) => {
    await tx`
      INSERT INTO extractions (id, data)
      SELECT x.id, x.data
      FROM jsonb_to_recordset(${tx.json(rows as never)}) AS x(id text, data jsonb)`;
    for (const row of rows) log.add("extractions", row.id, undefined, row.data);
    const people = [
      ...new Set(
        rows
          .map((row) => row.data.personNodeId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    if (people.length === 0) return 0;
    const updated = await tx<{ id: string; data: Record<string, unknown> }[]>`
      UPDATE nodes n SET
        data = jsonb_set(n.data, '{stats}',
          (CASE WHEN jsonb_typeof(n.data -> 'stats') = 'object' THEN n.data -> 'stats' ELSE '{}'::jsonb END)
            || jsonb_build_object('factsCount', c.n)),
        updated_at = clock_timestamp()
      FROM (
        SELECT p.id, (SELECT count(*) FROM extractions x WHERE x.person_node_id = p.id) AS n
        FROM unnest(${textArray(people)}::text[]) AS p(id)
      ) c
      WHERE n.id = c.id
      RETURNING n.id, n.data`;
    for (const row of updated) log.add("nodes", row.id, undefined, row.data);
    return updated.length;
  });
}
