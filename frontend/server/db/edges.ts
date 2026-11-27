import { useDb } from "./client";

/** An edge document as stored, with its id. */
export type EdgeDoc = { id: string; data: Record<string, unknown> };

/** Every edge with an end on one of `ids`, deleted ones too, in the order
 * `fetchEdgesClose` read them from Firestore: chunk by chunk of thirty ids,
 * within a chunk the edges leaving it before the edges arriving, each by id. */
export async function readEdgesTouching(ids: string[]): Promise<EdgeDoc[]> {
  if (ids.length === 0) return [];
  const sql = useDb();
  // Plain arrays, never `sql.array`: postgres.js 3.4.9 sends one in a
  // connection's first query, before it has read the array types, as a
  // scalar ("malformed array literal").
  const rows = await sql<(EdgeDoc & { source: string; target: string })[]>`
    SELECT id, data, source, target FROM edges
    WHERE source = ANY(${ids}::text[]) OR target = ANY(${ids}::text[])`;
  const chunkOf = new Map<string, number>();
  ids.forEach((id, i) => {
    if (!chunkOf.has(id)) chunkOf.set(id, Math.floor(i / 30));
  });
  const rank = (row: { source: string; target: string }) =>
    Math.min(
      chunkOf.has(row.source) ? chunkOf.get(row.source)! * 2 : Infinity,
      chunkOf.has(row.target) ? chunkOf.get(row.target)! * 2 + 1 : Infinity,
    );
  return rows
    .map((row) => ({ row, rank: rank(row) }))
    .sort((a, b) => a.rank - b.rank || byId(a.row.id, b.row.id))
    .map(({ row }) => ({ id: row.id, data: row.data }));
}

/** One edge document as stored, or undefined. */
export async function readEdgeDoc(
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const [row] = await useDb()<
    EdgeDoc[]
  >`SELECT id, data FROM edges WHERE id = ${id}`;
  return row?.data;
}

/** Every edge, by id (`fetchEdges`). */
export async function readAllEdges(): Promise<EdgeDoc[]> {
  const sql = useDb();
  return sql<EdgeDoc[]>`SELECT id, data FROM edges ORDER BY id`;
}

/** Byte order, as Firestore orders `__name__` and `COLLATE "C"` the ids. */
export function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
