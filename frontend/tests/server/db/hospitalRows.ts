import type postgres from "postgres";
import type {
  BoardEdgeRow,
  BoardPersonRow,
  HospitalPlaceRow,
} from "~~/server/utils/hospitalStats";
import { wojewodztwoOf } from "~~/shared/teryt";

/** The fields of `data` named, as a Firestore `select` hands them back: an
 * absent field stays absent. */
function pick(sql: postgres.Sql, alias: string, fields: string[]) {
  return sql`(SELECT coalesce(jsonb_object_agg(f.key, f.value), '{}')
    FROM jsonb_each(${sql(alias)}.data) f WHERE f.key = ANY(${fields}::text[]))`;
}

/** What `buildHospitalStats` reads, as /api/stats/hospitals read it before
 * 0603_hospital_stats.sql: the oracle's half of the hospital test. The
 * places are a superset (any place whose document names „szpitale”), so
 * that `isPublicHospital` and not SQL decides which count. */
export async function readHospitalRows(sql: postgres.Sql): Promise<{
  places: HospitalPlaceRow[];
  edges: BoardEdgeRow[];
  people: BoardPersonRow[];
  wojewodztwoNames: Record<string, string>;
}> {
  const placeRows = await sql<{ id: string; doc: HospitalPlaceRow }[]>`
    SELECT n.id, ${pick(sql, "n", [
      "name",
      "categories",
      "legalForm",
      "supervisoryOrgan",
      "isPublic",
      "published",
      "deleted",
    ])} AS doc
    FROM nodes n
    WHERE n.type = 'place' AND (n.data -> 'categories')::text LIKE '%"szpitale"%'
    ORDER BY n.id`;
  const places = placeRows.map((r) => ({ ...r.doc, id: r.id }));
  const ids = places.map((p) => p.id);
  if (ids.length === 0)
    return { places, edges: [], people: [], wojewodztwoNames: {} };

  const [edgeRows, seats] = await Promise.all([
    sql<{ doc: BoardEdgeRow }[]>`
      SELECT ${pick(sql, "e", [
        "source",
        "target",
        "name",
        "end_date",
        "published",
        "deleted",
      ])} AS doc
      FROM edges e WHERE e.target = ANY(${ids}::text[]) AND e.type = 'employed'
      ORDER BY e.id`,
    // The most specific seat wins (a powiat over its województwo), the first
    // by id between two of one depth, as the Firestore read ordered them.
    sql<{ place: string; teryt: string }[]>`
      SELECT DISTINCT ON (e.target) e.target AS place, r.data ->> 'teryt' AS teryt
      FROM edges e JOIN nodes r ON r.id = e.source
      WHERE e.target = ANY(${ids}::text[]) AND e.type = 'seat' AND NOT e.deleted
        AND jsonb_typeof(r.data -> 'teryt') = 'string' AND r.data ->> 'teryt' <> ''
      ORDER BY e.target, length(r.data ->> 'teryt') DESC, e.id`,
  ]);
  const edges = edgeRows.map((r) => r.doc);
  const personIds = [...new Set(edges.map((e) => e.source))].filter(
    (id): id is string => !!id,
  );
  const people = (
    await sql<{ id: string; doc: BoardPersonRow }[]>`
      SELECT n.id, ${pick(sql, "n", ["name", "parties", "published", "deleted"])} AS doc
      FROM nodes n WHERE n.id = ANY(${personIds}::text[])`
  ).map((r) => ({ ...r.doc, id: r.id }));

  const teryt = new Map(seats.map((s) => [s.place, s.teryt]));
  for (const place of places) {
    const code = teryt.get(place.id);
    if (code) place.regionTeryt = code;
  }
  const codes = [
    ...new Set(
      seats
        .map((s) => wojewodztwoOf(s.teryt))
        .filter((code): code is string => !!code)
        .map((code) => `teryt${code}`),
    ),
  ];
  const names = await sql<{ teryt: string; name: string }[]>`
    SELECT data ->> 'teryt' AS teryt, data ->> 'name' AS name FROM nodes
    WHERE id = ANY(${codes}::text[]) AND jsonb_typeof(data -> 'name') = 'string'
      AND jsonb_typeof(data -> 'teryt') = 'string'`;
  return {
    places,
    edges,
    people,
    wojewodztwoNames: Object.fromEntries(names.map((n) => [n.teryt, n.name])),
  };
}
