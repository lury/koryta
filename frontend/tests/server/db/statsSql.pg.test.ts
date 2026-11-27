import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { migrate } from "~~/server/db/migrate";
import { recountBatch } from "~~/server/db/batch";
import { textArray } from "~~/server/db/textArray";
import { touchedBy, type WrittenDoc } from "~~/server/db/writeEffects";
import type { Edge, Node, Person, Region } from "~~/shared/model";
import { normalizeUpdateTime } from "~~/shared/revisions";
import {
  RECOUNT_FIELDS,
  addFirstRevision,
  nodeGroupSizes,
  nodesByType,
  searchLineReader,
  type FirstRevisions,
  type NodeEntry,
} from "./batchFields";
import {
  isPowiat,
  partyCounts,
  regionStat,
  type RegionStat,
} from "~~/server/utils/regionStats";
import { buildHospitalStats } from "~~/server/utils/hospitalStats";
import { readHospitalRows } from "./hospitalRows";
import { countDatabase } from "./databaseCounts";
import {
  groupSizeMismatches,
  installGroupSizesOracle,
} from "./groupSizesOracle";

/** The SQL of 0601/0602 against the TypeScript it replaced, node for node,
 * on a loaded seed: `nodeGroupSize` (getNodeGroups), `searchLine`
 * (storedSearchLines), the home map's region rows (regionStat), the
 * hospital boards (buildHospitalStats), the sectors of node_categories and
 * the census of database_counts against the queries they replace, and the
 * incremental refreshes against the full ones after a write. The
 * TypeScript is the recount server/db/batch.ts ran until 0602, kept here as
 * the oracle; the nightly nodeGroupSize of groupSizes.ts is checked against
 * the SQL of 0602 as well (schema `group_oracle`, which it creates). Reads
 * the database and writes only in transactions it rolls back:
 *
 *   STATS_TEST_DATABASE_URL=postgres://... (a database load-seed.ts filled)
 *     npx vitest run tests/server/db/statsSql.pg.test.ts
 */

const DATABASE_URL = process.env.STATS_TEST_DATABASE_URL;

// Each incremental case runs the full refreshes twice over a loaded seed.
vi.setConfig({ testTimeout: 300_000 });

/** A document cut to the fields the recount reads, as Firestore's `select`
 * hands it. */
function picked(sql: postgres.Sql, fields: readonly string[]) {
  return sql`(SELECT coalesce(jsonb_object_agg(f.key, f.value), '{}')
    FROM jsonb_each(data) f WHERE f.key = ANY(${textArray([...fields])}::text[]))`;
}

/** Rows that differ, with the first few, so a failure says which. */
function mismatches<T>(
  ids: Iterable<string>,
  want: (id: string) => T,
  got: (id: string) => T,
) {
  const wrong: { id: string; want: T; got: T }[] = [];
  for (const id of ids) {
    const [w, g] = [want(id), got(id)];
    if (JSON.stringify(sortKeys(w)) !== JSON.stringify(sortKeys(g)))
      wrong.push({ id, want: w, got: g });
  }
  return { count: wrong.length, first: wrong.slice(0, 3) };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  return value;
}

describe.runIf(DATABASE_URL)("batch fields in SQL", () => {
  let sql: postgres.Sql;
  const now = new Date();
  let nodes: NodeEntry[];
  let edges: Edge[];
  let firsts: FirstRevisions;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 2, onnotice: () => {} });
    await migrate(sql);
    await installGroupSizesOracle(sql);
    await recountBatch(sql, { now });
    nodes = [
      ...(await sql<NodeEntry[]>`
        SELECT id, ${picked(sql, RECOUNT_FIELDS.nodes)} AS data FROM nodes ORDER BY id`),
    ];
    edges = (
      await sql<{ id: string; data: Edge }[]>`
        SELECT id, ${picked(sql, RECOUNT_FIELDS.edges)} AS data FROM edges ORDER BY id`
    ).map((row) => ({ ...row.data, id: row.id }) as Edge);
    firsts = {};
    for (const rev of await sql<
      { node_id: string; update_time: unknown; update_automatic: unknown }[]
    >`
      SELECT data -> 'node_id' AS node_id, data -> 'update_time' AS update_time,
        data -> 'update_automatic' AS update_automatic
      FROM revisions WHERE jsonb_typeof(data -> 'node_id') = 'string' ORDER BY id`) {
      addFirstRevision(
        firsts,
        rev.node_id,
        normalizeUpdateTime(rev.update_time),
        rev.update_automatic,
      );
    }
  }, 600_000);

  afterAll(async () => {
    await sql.end();
  });

  it("gives every node the nodeGroupSize getNodeGroups gives it", async () => {
    // Live edges only (0921).
    const want = nodeGroupSizes(
      nodesByType(nodes),
      edges.filter((edge) => edge.deleted !== true),
    );
    const rows = await sql<{ id: string; size: number }[]>`
      SELECT id, node_group_size AS size FROM node_derived`;
    const got = new Map(rows.map((r) => [r.id, r.size]));
    expect(got.size).toBe(nodes.length);
    const result = mismatches(
      nodes.map((n) => n.id),
      (id) => want[id] || 0,
      (id) => got.get(id),
    );
    expect(result).toEqual({ count: 0, first: [] });
  });

  it("gives every node the nodeGroupSize node_group_sizes gives it", async () => {
    expect(await groupSizeMismatches(sql)).toEqual({ count: 0, first: [] });
  });

  it("gives every person the searchLine storedSearchLines gives them", async () => {
    const record: Record<string, Node> = {};
    for (const n of nodes) record[n.id] = n.data;
    const byNode: Record<string, Edge[]> = {};
    for (const edge of edges)
      for (const key of [edge.source, edge.target])
        (byNode[key] ??= []).push(edge);
    const lines = searchLineReader(record, edges, firsts, now.getTime());
    const rows = await sql<{ id: string; line: unknown }[]>`
      SELECT id, search_line AS line FROM node_derived`;
    const got = new Map(rows.map((r) => [r.id, r.line]));
    const people = nodes.filter((n) => n.data.type === "person");
    const result = mismatches(
      people.map((n) => n.id),
      (id) => {
        const stored = lines({ id, data: record[id]! }, byNode[id] ?? []);
        return Object.keys(stored).length > 0 ? stored : null;
      },
      (id) => got.get(id) ?? null,
    );
    expect(result).toEqual({ count: 0, first: [] });
  });

  it("serves the region rows regionStat builds", async () => {
    const regions = await sql<
      { id: string; data: Partial<Region>; people: number | null }[]
    >`
      SELECT n.id, ${picked(sql, ["teryt", "name"])} AS data,
        (s.stats ->> 'people')::int AS people
      FROM nodes n LEFT JOIN node_stats s ON s.id = n.id
      WHERE n.type = 'region' ORDER BY n.id`;
    const members = await sql<
      { region_id: string; person_id: string; parties: unknown }[]
    >`
      SELECT t.target_id AS region_id, p.id AS person_id, p.data -> 'parties' AS parties
      FROM node_target t
      JOIN nodes r ON r.id = t.target_id AND r.type = 'region' AND length(r.data ->> 'teryt') = 4
      JOIN nodes p ON p.id = t.node_id AND p.type = 'person' AND p.is_approved
      WHERE t.in_approved AND t.node_id <> t.target_id`;
    const byRegion: Record<string, string[] | undefined> = {};
    const people: Record<string, Pick<Person, "parties">> = {};
    for (const m of members) {
      (byRegion[m.region_id] ??= []).push(m.person_id);
      people[m.person_id] = { parties: m.parties as Person["parties"] };
    }
    const want: RegionStat[] = regions.map((r) =>
      regionStat(
        r.id,
        { ...r.data, stats: { people: r.people ?? 0 } as Region["stats"] },
        isPowiat(r.data)
          ? partyCounts(byRegion[r.id] ?? [], people)
          : undefined,
      ),
    );
    const got = await sql<{ row: RegionStat }[]>`
      SELECT row FROM region_people_rows ORDER BY id`;
    expect(got.map((r) => sortKeys(r.row))).toEqual(want.map(sortKeys));
  });

  it("serves the hospital boards buildHospitalStats builds", async () => {
    const today = now.toISOString().slice(0, 10);
    const generatedAt = now.toISOString();
    const want = buildHospitalStats({
      ...(await readHospitalRows(sql)),
      generatedAt,
      today,
    });
    const [row] = await sql<{ doc: unknown }[]>`
      SELECT hospital_stats(${today}, ${generatedAt}) AS doc`;
    expect(want.hospitals).toBeGreaterThan(0);
    expect(row!.doc).toEqual(want);
  });

  it("ties every node to the sectors the category filter reached", async () => {
    // The filter before 0604: the sector's live places, then node_target.
    const rows = await sql<
      { category: string; flag: string; want: number; got: number }[]
    >`
      WITH cats AS (
        SELECT c, count(*) FROM nodes p, place_categories(p.data -> 'categories') c
        WHERE p.type = 'place' GROUP BY c ORDER BY count(*) DESC LIMIT 4
      ), flags(flag) AS (VALUES ('any'), ('in_approved'), ('cur_all'), ('cur_approved'))
      SELECT cats.c AS category, f.flag,
        (SELECT count(*) FROM nodes n WHERE NOT n.deleted AND n.type = 'person' AND EXISTS (
          SELECT 1 FROM node_target t WHERE t.node_id = n.id
            AND t.target_id IN (SELECT id FROM nodes WHERE type = 'place' AND NOT deleted
              AND data -> 'categories' ? cats.c)
            AND CASE f.flag WHEN 'in_approved' THEN t.in_approved WHEN 'cur_all' THEN t.cur_all
                            WHEN 'cur_approved' THEN t.cur_approved ELSE true END))::int AS want,
        (SELECT count(*) FROM node_categories c WHERE c.category = cats.c
          AND c.type = 'person' AND NOT c.deleted
          AND CASE f.flag WHEN 'in_approved' THEN c.in_approved WHEN 'cur_all' THEN c.cur_all
                          WHEN 'cur_approved' THEN c.cur_approved ELSE true END)::int AS got
      FROM cats, flags f`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.want !== r.got)).toEqual([]);
  });

  it("ties every node to the regions the teryt and companyTeryt filters reached", async () => {
    // The filters before 0940 (server/db/nodes.ts at 0607): the regions a
    // value names, or for companyTeryt the places they seat, then
    // node_target. Every województwo, and the five regions most tied to.
    const rows = await sql<
      { area: string; via: string; flag: string; want: number; got: number }[]
    >`
      WITH woj AS (
        SELECT DISTINCT left(data ->> 'teryt', 2) AS code FROM nodes
        WHERE type = 'region' AND NOT deleted AND data ->> 'teryt' ~ '^\\d{2,}$'
      ), picked AS (
        SELECT 'woj:' || code AS area,
          ARRAY(SELECT id FROM nodes WHERE type = 'region' AND NOT deleted
            AND data ->> 'teryt' ~ '^\\d{2,}$' AND left(data ->> 'teryt', 2) = woj.code) AS regions
        FROM woj
        UNION ALL
        SELECT * FROM (SELECT t.target_id, ARRAY[t.target_id] FROM node_target t
          JOIN nodes r ON r.id = t.target_id AND r.type = 'region'
          GROUP BY t.target_id ORDER BY count(*) DESC, t.target_id LIMIT 5) top
      ), seated AS (
        SELECT p.area, ARRAY(SELECT DISTINCT e.target FROM edges e
          WHERE e.source = ANY(p.regions) AND e.type IN ('seat', 'owns') AND NOT e.deleted
            AND e.target <> '' AND NOT EXISTS (SELECT 1 FROM nodes r
              WHERE r.id = e.target AND r.type = 'region' AND NOT r.deleted)) AS places
        FROM picked p
      ), targets AS (
        SELECT p.area, 'region' AS via, p.regions AS ids FROM picked p
        UNION ALL
        SELECT s.area, 'seat', s.places FROM seated s
      ), flags(flag) AS (VALUES ('any'), ('in_approved'), ('cur_all'), ('cur_approved'))
      SELECT x.area, x.via, f.flag,
        (SELECT count(*) FROM nodes n WHERE NOT n.deleted AND n.type = 'person' AND EXISTS (
          SELECT 1 FROM node_target t WHERE t.node_id = n.id AND t.target_id = ANY(x.ids)
            AND CASE f.flag WHEN 'in_approved' THEN t.in_approved WHEN 'cur_all' THEN t.cur_all
                            WHEN 'cur_approved' THEN t.cur_approved ELSE true END))::int AS want,
        (SELECT count(*) FROM node_areas a WHERE a.via = x.via AND a.area = x.area
          AND a.type = 'person' AND NOT a.deleted
          AND CASE f.flag WHEN 'in_approved' THEN a.in_approved WHEN 'cur_all' THEN a.cur_all
                          WHEN 'cur_approved' THEN a.cur_approved ELSE true END)::int AS got
      FROM targets x, flags f`;
    expect(rows.length).toBeGreaterThan(16 * 2 * 4);
    expect(rows.filter((r) => r.want > 0).length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.want !== r.got)).toEqual([]);
  });

  it("keeps the census /api/stats/database counted", async () => {
    const want = await countDatabase(sql);
    const [row] = await sql<{ counts: unknown }[]>`
      SELECT database_count_rows() AS counts`;
    expect(row!.counts).toEqual(want);
  });

  /** A write's incremental refreshes, then the full ones over the same
   * state: nothing left for the full ones to change. */
  async function afterWrite(
    write: (tx: postgres.TransactionSql) => Promise<
      | {
          nodes: string[];
          wide?: string[];
          ends?: string[];
          changed?: string[];
          docs?: string[];
        }
      | WrittenDoc[]
    >,
  ) {
    let left:
      | {
          categories: number;
          areas: number;
          hospitals: number;
          stats: number;
          derived: number;
        }
      | undefined;
    await sql
      .begin(async (tx) => {
        // Experience is counted to now(): the rows of the people whose
        // tenure crossed a tenth of a year since beforeAll change by
        // themselves.
        await tx`SELECT refresh_node_stats()`;
        const written = await write(tx);
        // The documents a write changed go through touchedBy, as the
        // write's own transaction hands them on (writeEffects.ts).
        const touched = Array.isArray(written)
          ? (({ nodes, wide, ends, changed, docs }) => ({
              nodes: [...nodes],
              wide: [...wide],
              ends: [...ends],
              changed: [...changed],
              docs: [...docs],
            }))(touchedBy(written))
          : written;
        await tx`SELECT refresh_node_stats_for(${textArray(touched.nodes)}::text[],
          ${textArray(touched.wide ?? [])}::text[])`;
        await tx`SELECT refresh_node_derived_for(${now}, ${textArray(touched.nodes)}::text[],
          ${textArray(touched.ends ?? [])}::text[], ${textArray(touched.changed ?? [])}::text[],
          ${touched.docs ? textArray(touched.docs) : null}::text[])`;
        const [categories] = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM (
            (SELECT * FROM node_category_rows() EXCEPT SELECT * FROM node_categories)
            UNION ALL
            (SELECT * FROM node_categories EXCEPT SELECT * FROM node_category_rows())) x`;
        const [areas] = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM (
            (SELECT * FROM node_area_rows() EXCEPT SELECT * FROM node_areas)
            UNION ALL
            (SELECT * FROM node_areas EXCEPT SELECT * FROM node_area_rows())
            UNION ALL
            (SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
             FROM (SELECT * FROM region_party_rows() EXCEPT SELECT * FROM region_party_counts
                   UNION ALL
                   SELECT * FROM region_party_counts EXCEPT SELECT * FROM region_party_rows()) p)) x`;
        // Ahead of refresh_node_stats(), which refreshes the hospitals too.
        const [hospitals] = await tx<{ n: number }[]>`
          SELECT refresh_hospital_stats()::int AS n`;
        const [stats] = await tx<{ n: number }[]>`
          SELECT refresh_node_stats()::int AS n`;
        const [lines] = await tx<{ n: number }[]>`
          SELECT refresh_node_derived(${now})::int AS n`;
        const sizes = await groupSizeMismatches(tx);
        left = {
          categories: categories!.n,
          areas: areas!.n,
          hospitals: hospitals!.n,
          stats: stats!.n,
          derived: lines!.n + sizes.count,
        };
        throw new Error("rollback");
      })
      .catch((error: Error) => {
        if (error.message !== "rollback") throw error;
      });
    return left;
  }

  it("leaves nothing for the full refresh after a new post at a big company", async () => {
    const left = await afterWrite(async (tx) => {
      const [pair] = await tx<{ person: string; place: string }[]>`
        SELECT p.id AS person, (SELECT e.target FROM edges e WHERE e.type = 'employed'
          GROUP BY e.target ORDER BY count(*) DESC, e.target LIMIT 1) AS place
        FROM nodes p WHERE p.type = 'person' AND p.is_approved ORDER BY p.id LIMIT 1`;
      return [
        await changed(
          tx,
          "edges",
          "stats-sql-test-edge",
          () =>
            tx`INSERT INTO edges (id, data) VALUES ('stats-sql-test-edge', ${tx.json(
              {
                type: "employed",
                source: pair!.person,
                target: pair!.place,
                name: "Rada Nadzorcza",
                start_date: "2020-01-01",
                published: true,
              } as never,
            )})`,
        ),
      ];
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });

  /** The document `write` changes in `table`, before and after, as the
   * write hands it on. */
  async function changed(
    tx: postgres.TransactionSql,
    table: "nodes" | "edges",
    id: string,
    write: () => Promise<unknown>,
  ): Promise<WrittenDoc> {
    const read = async () =>
      (
        await tx<{ data: Record<string, unknown> }[]>`
          SELECT data FROM ${tx(table)} WHERE id = ${id}`
      )[0]?.data;
    const before = await read();
    await write();
    return { collection: table, id, before, after: await read() };
  }

  /** An edge's source set to `source`, as the write hands it on. */
  async function moveSource(
    tx: postgres.TransactionSql,
    id: string,
    source: string,
  ): Promise<WrittenDoc[]> {
    const [before] = await tx<{ data: Record<string, unknown> }[]>`
      SELECT data FROM edges WHERE id = ${id}`;
    const [after] = await tx<{ data: Record<string, unknown> }[]>`
      UPDATE edges SET data = jsonb_set(data, '{source}', to_jsonb(${source}::text))
      WHERE id = ${id} RETURNING data`;
    return [
      { collection: "edges", id, before: before!.data, after: after!.data },
    ];
  }

  it("leaves nothing for the full refresh after a seat edge moves a company", async () => {
    const left = await afterWrite(async (tx) => {
      const [seat] = await tx<{ id: string; source: string; target: string }[]>`
        SELECT id, source, target FROM edges WHERE type = 'seat' ORDER BY id LIMIT 1`;
      const [other] = await tx<{ id: string }[]>`
        SELECT id FROM nodes WHERE type = 'region' AND id <> ${seat!.source}
          AND length(data ->> 'teryt') = 7 ORDER BY id LIMIT 1`;
      return moveSource(tx, seat!.id, other!.id);
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });

  it("leaves nothing for the full refresh after a place is renamed", async () => {
    const left = await afterWrite(async (tx) => {
      const [place] = await tx<{ id: string }[]>`
        SELECT e.target AS id FROM edges e WHERE e.type = 'employed'
        GROUP BY e.target ORDER BY count(*) DESC, e.target LIMIT 1`;
      return [
        await changed(
          tx,
          "nodes",
          place!.id,
          () => tx`UPDATE nodes SET data = jsonb_set(data, '{name}', '"PRZEDSIĘBIORSTWO \\"NOWE\\" (Mielec)"')
            WHERE id = ${place!.id}`,
        ),
      ];
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });

  it("leaves nothing for the full refresh after a board seat at a hospital", async () => {
    const left = await afterWrite(async (tx) => {
      const [pair] = await tx<{ person: string; place: string }[]>`
        SELECT (SELECT p.id FROM nodes p WHERE p.type = 'person' AND p.is_approved
            AND jsonb_typeof(p.data -> 'parties') = 'array' ORDER BY p.id LIMIT 1) AS person,
          (SELECT h.id FROM hospital_places h ORDER BY h.id LIMIT 1) AS place`;
      return [
        await changed(
          tx,
          "edges",
          "stats-sql-test-seat",
          () =>
            tx`INSERT INTO edges (id, data) VALUES ('stats-sql-test-seat', ${tx.json(
              {
                type: "employed",
                source: pair!.person,
                target: pair!.place,
                name: "Rada  nadzorcza (przewodniczący)",
                start_date: "2024-01-01",
                published: true,
              } as never,
            )})`,
        ),
      ];
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });

  it("leaves nothing for the full refresh after a hospital is unpublished", async () => {
    const left = await afterWrite(async (tx) => {
      const [place] = await tx<{ id: string }[]>`
        SELECT h.id FROM hospital_places h
        ORDER BY (SELECT count(*) FROM hospital_seats s WHERE s.place_id = h.id) DESC, h.id LIMIT 1`;
      return [
        await changed(
          tx,
          "nodes",
          place!.id,
          () =>
            tx`UPDATE nodes SET data = data || '{"published": false}' WHERE id = ${place!.id}`,
        ),
      ];
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });

  it("leaves nothing for the full refresh after a hospital's seat moves", async () => {
    const left = await afterWrite(async (tx) => {
      const [seat] = await tx<{ id: string; source: string; target: string }[]>`
        SELECT e.id, e.source, e.target FROM edges e JOIN hospital_places h ON h.id = e.target
        WHERE e.type = 'seat' AND NOT e.deleted ORDER BY e.id LIMIT 1`;
      const [other] = await tx<{ id: string }[]>`
        SELECT id FROM nodes WHERE type = 'region' AND id <> ${seat!.source}
          AND length(data ->> 'teryt') = 7 AND left(data ->> 'teryt', 2) <> (
            SELECT left(data ->> 'teryt', 2) FROM nodes WHERE id = ${seat!.source})
        ORDER BY id LIMIT 1`;
      return moveSource(tx, seat!.id, other!.id);
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });

  it("leaves nothing for the full refresh after the seat of the busiest region moves", async () => {
    const left = await afterWrite(async (tx) => {
      // The region with the most companies seated in it, whose whole tree
      // the refresh used to recount.
      const [seat] = await tx<{ id: string; source: string }[]>`
        SELECT e.id, e.source FROM edges e
        WHERE e.type = 'seat' AND NOT e.deleted AND e.source = (
          SELECT source FROM edges WHERE type = 'seat' AND NOT deleted
          GROUP BY source ORDER BY count(*) DESC, source LIMIT 1)
        ORDER BY e.id LIMIT 1`;
      const [other] = await tx<{ id: string }[]>`
        SELECT id FROM nodes WHERE type = 'region' AND id <> ${seat!.source}
          AND length(data ->> 'teryt') = 7 ORDER BY id DESC LIMIT 1`;
      return moveSource(tx, seat!.id, other!.id);
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });

  it("leaves nothing for the full refresh after a company with subsidiaries changes owner", async () => {
    const left = await afterWrite(async (tx) => {
      // An `owns` edge into a company that owns others: the places below it
      // get other ancestors.
      const [owns] = await tx<{ id: string; source: string }[]>`
        SELECT e.id, e.source FROM edges e
        JOIN nodes s ON s.id = e.source AND s.type = 'place'
        WHERE e.type = 'owns' AND NOT e.deleted AND EXISTS (
          SELECT 1 FROM edges b WHERE b.source = e.target AND b.type = 'owns' AND NOT b.deleted)
        ORDER BY e.id LIMIT 1`;
      const [other] = await tx<{ id: string }[]>`
        SELECT e.source AS id FROM edges e JOIN nodes s ON s.id = e.source AND s.type = 'place'
        WHERE e.type = 'owns' AND NOT e.deleted AND e.source <> ${owns!.source}
        GROUP BY e.source ORDER BY count(*) DESC, e.source LIMIT 1`;
      return moveSource(tx, owns!.id, other!.id);
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });

  it("leaves nothing for the full refresh after a region moves to another województwo", async () => {
    const left = await afterWrite(async (tx) => {
      // The region below a województwo with the most companies seated in it.
      const [region] = await tx<
        { id: string; data: Record<string, unknown> }[]
      >`
        SELECT r.id, r.data FROM nodes r JOIN edges e ON e.source = r.id AND e.type = 'seat'
        WHERE r.type = 'region' AND length(r.data ->> 'teryt') > 2
        GROUP BY r.id ORDER BY count(*) DESC, r.id LIMIT 1`;
      const teryt = String(region!.data.teryt);
      const moved = (teryt.startsWith("02") ? "04" : "02") + teryt.slice(2);
      const [after] = await tx<{ data: Record<string, unknown> }[]>`
        UPDATE nodes SET data = jsonb_set(data, '{teryt}', to_jsonb(${moved}::text))
        WHERE id = ${region!.id} RETURNING data`;
      return [
        {
          collection: "nodes",
          id: region!.id,
          before: region!.data,
          after: after!.data,
        },
      ];
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });

  it("leaves nothing for the full refresh after a place joins a sector", async () => {
    const left = await afterWrite(async (tx) => {
      const [place] = await tx<{ id: string }[]>`
        SELECT e.target AS id FROM edges e JOIN nodes p ON p.id = e.target AND p.type = 'place'
        WHERE e.type = 'employed' AND NOT (p.data -> 'categories' ? 'szpitale')
        GROUP BY e.target ORDER BY count(*) DESC, e.target LIMIT 1`;
      return [
        await changed(
          tx,
          "nodes",
          place!.id,
          () => tx`UPDATE nodes SET data = jsonb_set(data, '{categories}',
          coalesce(CASE WHEN jsonb_typeof(data -> 'categories') = 'array' THEN data -> 'categories' END, '[]')
          || '["szpitale"]')
            WHERE id = ${place!.id}`,
        ),
      ];
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });

  it("leaves nothing for the full refresh after a person in a big powiat is published", async () => {
    const left = await afterWrite(async (tx) => {
      const [person] = await tx<{ id: string }[]>`
        SELECT t.node_id AS id FROM node_target t
        JOIN nodes r ON r.id = t.target_id AND r.type = 'region' AND length(r.data ->> 'teryt') = 4
        JOIN nodes p ON p.id = t.node_id AND p.type = 'person' AND NOT p.is_approved
        WHERE t.in_approved
        GROUP BY t.node_id ORDER BY count(*) DESC, t.node_id LIMIT 1`;
      return [
        await changed(
          tx,
          "nodes",
          person!.id,
          () =>
            tx`UPDATE nodes SET data = data || '{"published": true}' WHERE id = ${person!.id}`,
        ),
      ];
    });
    expect(left).toEqual({
      categories: 0,
      areas: 0,
      hospitals: 0,
      stats: 0,
      derived: 0,
    });
  });
});
