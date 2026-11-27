import { useDb } from "./client";
import type { Feedback, NoteEntryKind } from "../../shared/model";

/** The reads of the admin dashboard's summary (/api/admin/summary) on
 * Postgres. Counts are exact; the samples and the manual/automatic split
 * read a bounded page, as on Firestore. */

export type NoteSampleRow = {
  noteId: string;
  nodeId: string;
  url: string | null;
  note: string;
  kind: NoteEntryKind;
  adminType: string | null;
};

/** Note entries waiting on an admin (`noteNeedsAction`: an explicit status
 * wins, else any kind but a plain source), the sources nobody has typed or
 * deferred, and the first `sample` waiting entries in document order. */
export async function noteCountsPg(sample: number): Promise<{
  needsAction: number;
  uncategorized: number;
  sample: NoteSampleRow[];
}> {
  const sql = useDb();
  const rows = await sql<
    { needs_action: number; uncategorized: number; sample: NoteSampleRow[] }[]
  >`
    WITH entries AS (
      SELECT n.id AS note_id, n.data -> 'nodeId' AS node_id, s.value AS e, s.at,
        CASE WHEN jsonb_truthy(s.value -> 'adminStatus')
          THEN s.value -> 'adminStatus' = '"unresolved"'
          ELSE coalesce(nullif(s.value -> 'kind', 'null'), '"source"') <> '"source"'
        END AS needs_action
      FROM notes n,
        jsonb_array_elements(CASE WHEN jsonb_typeof(n.data -> 'sources') = 'array'
          THEN n.data -> 'sources' ELSE '[]' END) WITH ORDINALITY AS s(value, at)
    ), picked AS (
      SELECT * FROM entries WHERE needs_action ORDER BY note_id, at LIMIT ${sample}
    )
    SELECT
      (SELECT count(*) FROM entries WHERE needs_action)::int AS needs_action,
      (SELECT count(*) FROM entries
        WHERE NOT jsonb_truthy(e -> 'adminType')
          AND NOT jsonb_truthy(e -> 'adminTypeDeferred'))::int AS uncategorized,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
          'noteId', note_id,
          'nodeId', node_id,
          'url', coalesce(e -> 'url', 'null'),
          'note', e -> 'note',
          'kind', coalesce(nullif(e -> 'kind', 'null'), '"source"'),
          'adminType', coalesce(e -> 'adminType', 'null'))
        ORDER BY note_id, at) FROM picked), '[]') AS sample`;
  const row = rows[0]!;
  return {
    needsAction: row.needs_action,
    uncategorized: row.uncategorized,
    sample: row.sample,
  };
}

/** Reports still marked new: how many, and the newest `cap` of them. */
export async function newFeedbackPg(
  cap: number,
): Promise<{ total: number; newest: (Feedback & { id: string })[] }> {
  const sql = useDb();
  const [[count], rows] = await Promise.all([
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM feedback
      WHERE data -> 'adminStatus' = '"new"'`,
    sql<{ id: string; data: Feedback }[]>`
      SELECT id, data FROM feedback
      WHERE (data ->> 'adminStatus') = 'new'
        AND data -> 'adminStatus' = '"new"' AND data ? 'createdAt'
      ORDER BY (data ->> 'createdAt') COLLATE "C" DESC, id DESC
      LIMIT ${cap}`,
  ]);
  return {
    total: count?.n ?? 0,
    newest: rows.map(({ id, data }) => ({ ...data, id })),
  };
}

export type UnapprovedNodeRow = {
  id: string;
  name: unknown;
  type: unknown;
  automatic: boolean;
};

/** Nodes whose latest revision is not the approved one: how many, and the
 * first `cap` by id with whether that latest revision was an automatic
 * import. `latest_id` is a revision id or, now and then, its path; one that
 * resolves to nothing counts as manual. */
export async function unapprovedNodesPg(
  cap: number,
): Promise<{ total: number; inspected: UnapprovedNodeRow[] }> {
  const sql = useDb();
  const [[count], rows] = await Promise.all([
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM nodes
      WHERE data #> '{revisions,has_unapproved}' = 'true'`,
    sql<UnapprovedNodeRow[]>`
      SELECT n.id, n.data -> 'name' AS name, n.data -> 'type' AS type,
        coalesce(r.data -> 'update_automatic' = 'true', false) AS automatic
      FROM (
        SELECT id, data FROM nodes
        WHERE data #> '{revisions,has_unapproved}' = 'true'
        ORDER BY id LIMIT ${cap}
      ) n
      LEFT JOIN revisions r ON r.id = regexp_replace(
        jsonb_text(n.data #> '{revisions,latest_id}'), '^.*/', '')
      ORDER BY n.id`,
  ]);
  return { total: count?.n ?? 0, inspected: rows };
}

export type PendingEdgeRow = {
  id: string;
  edge_id: string;
  automatic: boolean;
  edge: { source?: unknown; target?: unknown; type?: unknown } | null;
};

/** Edge proposals nobody has settled: how many, and the newest `cap` with
 * the edge each is about (null once the edge is gone). */
export async function pendingEdgeRevisionsPg(
  cap: number,
): Promise<{ total: number; inspected: PendingEdgeRow[] }> {
  const sql = useDb();
  const pending = sql`
    data -> 'collection' = '"edges"' AND data -> 'status' = '"pending"'`;
  const [[count], rows] = await Promise.all([
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM revisions WHERE ${pending}`,
    sql<PendingEdgeRow[]>`
      SELECT r.id, coalesce(r.data ->> 'node_id', '') AS edge_id,
        r.data -> 'update_automatic' = 'true' AS automatic,
        e.data AS edge
      FROM (
        SELECT id, data, update_time FROM revisions
        WHERE ${pending} AND update_time IS NOT NULL
        ORDER BY update_time DESC, id DESC LIMIT ${cap}
      ) r
      LEFT JOIN edges e ON e.id = r.data ->> 'node_id'
      ORDER BY r.update_time DESC, r.id DESC`,
  ]);
  return {
    total: count?.n ?? 0,
    inspected: rows.map((row) => ({
      ...row,
      automatic: row.automatic === true,
    })),
  };
}

/** The names of these nodes, those that have a string one. */
export async function nodeNamesPg(
  ids: readonly string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id) => id))];
  if (wanted.length === 0) return new Map();
  const rows = await useDb()<{ id: string; name: string }[]>`
    SELECT id, jsonb_text(data -> 'name') AS name FROM nodes
    WHERE id = ANY(${wanted}::text[]) AND jsonb_text(data -> 'name') IS NOT NULL`;
  return new Map(rows.map((row) => [row.id, row.name]));
}
