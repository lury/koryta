import type { PendingQuery, Row } from "postgres";
import { useDb, type Db } from "./client";
import { textArray } from "./textArray";
import {
  pageIsPublic,
  type NodeRevisions,
  type NodeType,
} from "../../shared/model";
import { isWojewodztwoTeryt } from "../../shared/teryt";
import {
  electionResultKey,
  type ElectionResult,
} from "../../shared/electionDays";

/** A node as /api/nodes and `fetchNodes` hand it out: the document, its id,
 * `visibility`, and `stats` with the derived part (node_stats) laid over the
 * batch fields the document stores. */
export type NodeRow = {
  id: string;
  visibility: boolean;
  [field: string]: unknown;
};

export type Fragment = PendingQuery<Row[]>;

// Lists go in as plain arrays, never `sql.array`: postgres.js 3.4.9 sends one
// in a connection's first query, before it has read the array types, as a
// scalar ("malformed array literal").

/** The document as served, for a `nodes n LEFT JOIN node_stats s LEFT JOIN
 * node_derived d`: the stored stats with the derived ones laid over them
 * (0002_node_stats.sql, and `nodeGroupSize` and `searchLine` from
 * 0601_stats_sql.sql). A node no refresh has seen since it was written keeps
 * its stored stats. */
export function servedDoc(sql: Db): Fragment {
  return sql`CASE WHEN s.stats IS NULL AND d.id IS NULL THEN n.data - 'nameChunksLower'
    ELSE (n.data - 'nameChunksLower') || jsonb_build_object('stats',
      coalesce(n.data -> 'stats', '{}') || coalesce(s.stats, '{}')
      || derived_stats(d.node_group_size, d.search_line)) END`;
}

/** `nodeGroupSize` and `searchLine` of these nodes, which 0602 moved out of
 * the stored `stats` into node_derived: for the readers that serve the
 * stored document rather than `servedDoc`. */
export async function withDerivedStats<
  T extends { id: string; data: Record<string, unknown> },
>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const sql = useDb();
  const derived = await sql<{ id: string; stats: Record<string, unknown> }[]>`
    SELECT id, derived_stats(node_group_size, search_line) AS stats FROM node_derived
    WHERE id = ANY(${textArray(rows.map((row) => row.id))}::text[])`;
  const byId = new Map(derived.map((row) => [row.id, row.stats]));
  return rows.map((row) => {
    const stats = byId.get(row.id);
    if (!stats || Object.keys(stats).length === 0) return row;
    const stored = (row.data.stats ?? {}) as Record<string, unknown>;
    return { ...row, data: { ...row.data, stats: { ...stored, ...stats } } };
  });
}

export function toRow(id: string, doc: Record<string, unknown>): NodeRow {
  return { id, ...doc, visibility: pageIsPublic(doc) };
}

export function and(sql: Db, parts: Fragment[]): Fragment {
  return parts.reduce((all, part) => sql`${all} AND ${part}`, sql`true`);
}

/** `fetchNodes` (server/utils/fetch.ts): every node of a type,
 * merged-away pages left out, or the one asked for by id. */
export async function readNodesOfType(
  type: string,
  options: { nodeId?: string; personParties?: string | string[] } = {},
): Promise<Record<string, NodeRow>> {
  const sql = useDb();
  if (options.nodeId) {
    const rows = await sql<{ id: string; doc: Record<string, unknown> }[]>`
      SELECT n.id, ${servedDoc(sql)} AS doc
      FROM nodes n LEFT JOIN node_stats s ON s.id = n.id LEFT JOIN node_derived d ON d.id = n.id
      WHERE n.id = ${options.nodeId} AND n.type = ${type}`;
    // The one place `fetchNodes` keeps a merged-away page, and without
    // `visibility`, as it always has.
    return Object.fromEntries(
      rows.map((r) => [r.id, { id: r.id, ...r.doc } as NodeRow]),
    );
  }
  const where = [sql`n.type = ${type}`, sql`NOT n.deleted`];
  if (options.personParties)
    where.push(partiesFilter(sql, options.personParties));
  const rows = await sql<{ id: string; doc: Record<string, unknown> }[]>`
    SELECT n.id, ${servedDoc(sql)} AS doc
    FROM nodes n LEFT JOIN node_stats s ON s.id = n.id LEFT JOIN node_derived d ON d.id = n.id
    WHERE ${and(sql, where)}
    ORDER BY n.id`;
  return Object.fromEntries(rows.map((r) => [r.id, toRow(r.id, r.doc)]));
}

/** What a sitemap entry is made of, as stored. */
export type SitemapPage = {
  type?: unknown;
  name?: unknown;
  published?: unknown;
  deleted?: unknown;
  content_changed_at?: string;
  revisions?: NodeRevisions | null;
};

/** The fields a sitemap entry is made of (`inSitemap`, `sitemapLastmod`),
 * of every live page of `type` with a name: the stored document's, not the
 * served one with its statistics. The sitemap read every node of the type
 * whole through `fetchNodes`. */
export async function readSitemapPages(
  type: string,
): Promise<Record<string, SitemapPage>> {
  const sql = useDb();
  const rows = await sql<{ id: string; doc: SitemapPage }[]>`
    SELECT n.id, jsonb_strip_nulls(jsonb_build_object(
      'type', n.data -> 'type', 'name', n.data -> 'name',
      'published', n.data -> 'published', 'deleted', n.data -> 'deleted',
      'content_changed_at', n.data -> 'content_changed_at',
      'revisions', n.data -> 'revisions')) AS doc
    FROM nodes n
    WHERE n.type = ${type} AND n.is_approved AND jsonb_typeof(n.data -> 'name') = 'string'
    ORDER BY n.id`;
  return Object.fromEntries(rows.map((r) => [r.id, r.doc]));
}

/** The live, named pages of the sitemap's types whose id is `key` once
 * lowercased and stripped of trailing punctuation (`mangledIdKey`), two at
 * most: the caller wants exactly one. */
export async function readPagesByMangledId(
  key: string,
): Promise<{ id: string; type: NodeType; name: string }[]> {
  const sql = useDb();
  return sql<{ id: string; type: NodeType; name: string }[]>`
    SELECT n.id, n.type, n.data ->> 'name' AS name FROM nodes n
    WHERE lower(regexp_replace(n.id, '[^A-Za-z0-9]+$', '')) = ${key}
      AND n.type IN ('person', 'place', 'article') AND n.is_approved
      AND jsonb_typeof(n.data -> 'name') = 'string' AND n.data ->> 'name' <> ''
    ORDER BY n.id LIMIT 2`;
}

/** `parties` / `party`: any of them, `__NONE__` for nobody's. A person with
 * no `parties` field at all counts as nobody's, as the in-memory filter has
 * always had it. */
function partiesFilter(sql: Db, parties: string | string[]): Fragment {
  const wanted = Array.isArray(parties) ? parties : [parties];
  const named = wanted.filter((p) => p !== "__NONE__");
  const either: Fragment[] = [];
  if (named.length > 0)
    either.push(sql`n.data -> 'parties' ?| ${named}::text[]`);
  if (wanted.includes("__NONE__"))
    either.push(sql`coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(n.data -> 'parties') = 'array'
      THEN n.data -> 'parties' END), 0) = 0`);
  if (either.length === 0) return sql`true`;
  return sql`(${either.reduce((all, part) => sql`${all} OR ${part}`)})`;
}

export type NodeListQuery = {
  type?: string;
  party?: string;
  parties?: string | string[];
  teryt?: string;
  companyTeryt?: string;
  krs?: string | string[];
  place?: string | string[];
  category?: string;
  visibility?: "public" | "private";
  hideVoted?: "all" | "no_votes" | "has_votes";
  currentlyEmployed?: "all" | "any" | "selected";
  minEmploymentDate?: string;
  minVotes?: number;
  queueTier?: number;
  election?: string | string[];
  electionResult?: ElectionResult;
  id?: string;
  ids?: string[];
  sortBy?: string;
  sortDesc?: "true" | "false";
  page?: number;
  limit?: number;
};

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/** Region ids a `teryt` covers: a województwo with everything in it, or the
 * one region with that code (nodeFilters.ts, `resolveRegionIds`). */
async function regionIds(sql: Db, teryt: string): Promise<string[]> {
  const rows = isWojewodztwoTeryt(teryt)
    ? await sql<{ id: string }[]>`
        SELECT id FROM nodes
        WHERE type = 'region' AND NOT deleted
          AND data ->> 'teryt' ~ '^\\d{2,}$' AND left(data ->> 'teryt', 2) = ${teryt}`
    : await sql<{ id: string }[]>`
        SELECT id FROM nodes WHERE type = 'region' AND data ->> 'teryt' = ${teryt}
        ORDER BY id LIMIT 1`;
  return rows.map((r) => r.id);
}

/** Every place id the place, KRS, category and seat filters leave, or null
 * when none of them is set (nodeFilters.ts, `placeIdSets`). */
async function placeIds(
  sql: Db,
  query: NodeListQuery,
): Promise<string[] | null> {
  const sets: string[][] = [];
  if (query.place || query.krs) {
    const krs = [...new Set(toArray(query.krs))];
    const byKrs = krs.length
      ? await sql<{ id: string }[]>`
          SELECT id FROM nodes WHERE type = 'place'
            AND data ->> 'krsNumber' = ANY(${krs}::text[])`
      : [];
    sets.push([
      ...new Set([...toArray(query.place), ...byKrs.map((r) => r.id)]),
    ]);
  }
  // Alone, a sector is node_categories' (`structuralFilters`); beside
  // another place filter the two must meet at one place.
  if (query.category && (query.place || query.krs || query.companyTeryt)) {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM nodes WHERE type = 'place' AND NOT deleted
        AND data -> 'categories' ? ${query.category}`;
    sets.push(rows.map((r) => r.id));
  }
  // Alone, a seat region is node_areas' (`structuralFilters`); beside
  // another place filter the two must meet at one place.
  if (query.companyTeryt && (query.place || query.krs || query.category)) {
    const regions = await regionIds(sql, query.companyTeryt);
    // Seats (and `owns`, while the migration to seats runs) from the
    // regions, to anything that is not a region itself.
    const rows = regions.length
      ? await sql<{ id: string }[]>`
          SELECT DISTINCT e.target AS id FROM edges e
          WHERE e.source = ANY(${regions}::text[])
            AND e.type IN ('seat', 'owns') AND NOT e.deleted AND e.target <> ''
            AND NOT EXISTS (SELECT 1 FROM nodes r
              WHERE r.id = e.target AND r.type = 'region' AND NOT r.deleted)`
      : [];
    sets.push(rows.map((r) => r.id));
  }
  if (sets.length === 0) return null;
  return sets.reduce((acc, next) => {
    const allowed = new Set(next);
    return acc.filter((id) => allowed.has(id));
  });
}

/** Sort expression for `sortBy`, as `buildSortOp` maps the keys. */
function sortExpression(
  sql: Db,
  sortBy: string,
  scope: string,
  sector: boolean,
): Fragment {
  switch (sortBy) {
    case "experience":
      return sql`s.${sql(`experience_${scope}`)}`;
    case "latestEmploymentStart":
      return sector
        ? sql`c.${sql(`latest_${scope}`)}`
        : sql`s.${sql(`latest_${scope}`)} COLLATE "C"`;
    case "notesCount":
      return sql`(s.stats ->> 'notesCount')::numeric`;
    case "factsCount":
      return sql`(s.stats ->> 'factsCount')::numeric`;
    case "visibility":
      return sql`n.is_approved`;
    case "name":
      return sql`jsonb_text(n.data -> 'name') COLLATE "C"`;
    case "stats.votes.interesting":
    case "votes.interesting":
      return sql`s.interesting`;
  }
  // Any other field path, as Firestore would order it, over the served
  // document: jsonb's order, which ranks types differently from Firestore's.
  const path = sortBy.startsWith("votes.")
    ? ["stats", "votes", sortBy.split(".")[1]!]
    : sortBy.split(".");
  return sql`(${servedDoc(sql)}) #> ${path}::text[]`;
}

/** Whether the sector filter is read from node_categories: when it is the
 * only place filter. */
function bySector(query: NodeListQuery): query is NodeListQuery & {
  category: string;
} {
  return !!query.category && !query.place && !query.krs && !query.companyTeryt;
}

/** Whether the seat region filter is read from node_areas: when it is the
 * only place filter. */
function bySeat(query: NodeListQuery): query is NodeListQuery & {
  companyTeryt: string;
} {
  return !!query.companyTeryt && !query.place && !query.krs && !query.category;
}

/** Whether the filters are all the driving index holds (node_categories `c`
 * for a sector, node_areas `a` for a region), so that it alone answers a
 * count: the sector or the one region, whether the tie is current, and
 * (`listNodes`) whether the page is published or voted on. */
export function indexOnly(query: NodeListQuery): boolean {
  const regionFilters = (query.teryt ? 1 : 0) + (bySeat(query) ? 1 : 0);
  const driven = bySector(query)
    ? regionFilters === 0
    : regionFilters === 1 && !query.category;
  return (
    driven &&
    query.currentlyEmployed !== "any" &&
    !query.party &&
    !query.parties &&
    !query.minEmploymentDate &&
    query.minVotes == null &&
    query.queueTier == null &&
    !query.election &&
    !query.id &&
    !query.ids
  );
}

/** The `area` of node_areas a region filter value names: a województwo's
 * `woj:` and two digits, else the one region's id. */
function areaOf(teryt: string, regions: string[]): string {
  return isWojewodztwoTeryt(teryt) ? `woj:${teryt}` : regions[0]!;
}

export type NodeList = {
  rows: NodeRow[];
  total: number;
  /** Place and region ids the place and region filters resolved to. */
  targetIds?: string[];
};

/** What the structural filters of the table leave, over `nodes n LEFT JOIN node_stats s`:
 * shared by /api/nodes and /api/stats/progress. "empty" when a filter value
 * resolves to nothing. */
export async function structuralFilters(
  sql: Db,
  query: NodeListQuery,
  scope: "all" | "approved",
): Promise<
  | {
      where: Fragment[];
      /** Said again on node_stats `s`, for the page's plan only. */
      hints: Fragment[];
      /** Whether `where` reads node_stats `s`; a count without it does not
       * join it. */
      usesStats: boolean;
      compared: Fragment[];
      targetIds?: string[];
      /** The rows to filter: `nodes n`, or the rows of the driving index
       * (`index`) joined to it. */
      from: Fragment;
      /** The sector `c` holds, if any. */
      sector?: string;
      /** The regions of a seat filter read from node_areas: the companies
       * seated in them are worked out for the page alone (`listNodes`). */
      seatRegions?: string[];
      /** The driving index, node_categories `c` or node_areas `a`, if any;
       * `where` says over it alone what `where` says of it. */
      index?: { alias: "c" | "a"; from: Fragment; where: Fragment[] };
    }
  | "empty"
> {
  const where: Fragment[] = [sql`NOT n.deleted`];
  let targetIds: string[] | undefined;
  let from = sql`nodes n`;
  let sector: string | undefined;
  let seatRegions: string[] | undefined;
  let index:
    { alias: "c" | "a"; from: Fragment; where: Fragment[] } | undefined;

  if (query.id) where.push(sql`n.id = ${query.id}`);
  if (query.ids) where.push(sql`n.id = ANY(${query.ids}::text[])`);
  if (query.type) where.push(sql`n.type = ${query.type}`);
  const parties = query.parties || query.party;
  if (parties) where.push(partiesFilter(sql, parties));

  const targetFlag =
    query.currentlyEmployed === "selected"
      ? sql`t.${sql(`cur_${scope}`)}`
      : scope === "approved"
        ? sql`t.in_approved`
        : sql`true`;
  const reaches = (ids: string[]) => sql`EXISTS (SELECT 1 FROM node_target t
    WHERE t.node_id = n.id AND t.target_id = ANY(${ids}::text[]) AND ${targetFlag})`;

  /** The tie flag of `currentlyEmployed` and the scope, on an index row. */
  const indexFlag = (alias: "c" | "a") =>
    query.currentlyEmployed === "selected"
      ? sql`${sql(alias)}.${sql(`cur_${scope}`)}`
      : scope === "approved"
        ? sql`${sql(alias)}.in_approved`
        : sql`true`;
  /** Drives the list from an index: the same rows as `reaches`, with the
   * node's fields again on the index for the planner to use it. */
  const drive = (alias: "c" | "a", table: string, conditions: Fragment[]) => {
    const on = [
      ...conditions,
      sql`NOT ${sql(alias)}.deleted`,
      indexFlag(alias),
    ];
    if (query.type) on.push(sql`${sql(alias)}.type = ${query.type}`);
    index = {
      alias,
      from: sql`${sql(table)} ${sql(alias)}`,
      where: on,
    };
    from = sql`${sql(table)} ${sql(alias)} JOIN nodes n ON n.id = ${sql(alias)}.node_id`;
    where.push(...on);
  };
  /** The nodes node_areas ties to `area` through `via`, for a filter beside
   * the driving one. */
  const inArea = (via: "region" | "seat", area: string) =>
    sql`EXISTS (SELECT 1 FROM node_areas x WHERE x.via = ${via} AND x.area = ${area}
      AND x.node_id = n.id AND ${
        query.currentlyEmployed === "selected"
          ? sql`x.${sql(`cur_${scope}`)}`
          : scope === "approved"
            ? sql`x.in_approved`
            : sql`true`
      })`;

  if (bySector(query)) {
    sector = query.category;
    drive("c", "node_categories", [sql`c.category = ${sector}`]);
  }
  const places = await placeIds(sql, query);
  if (places) {
    if (places.length === 0) return "empty";
    where.push(reaches(places));
    targetIds = places;
  }
  if (query.teryt) {
    const regions = await regionIds(sql, query.teryt);
    if (regions.length === 0) return "empty";
    const area = areaOf(query.teryt, regions);
    if (index) where.push(inArea("region", area));
    else
      drive("a", "node_areas", [sql`a.via = 'region'`, sql`a.area = ${area}`]);
    targetIds = [...(targetIds ?? []), ...regions];
  }
  if (bySeat(query)) {
    const regions = await regionIds(sql, query.companyTeryt);
    if (regions.length === 0) return "empty";
    const area = areaOf(query.companyTeryt, regions);
    if (index) where.push(inArea("seat", area));
    else drive("a", "node_areas", [sql`a.via = 'seat'`, sql`a.area = ${area}`]);
    seatRegions = regions;
    targetIds ??= [];
  }
  if (query.currentlyEmployed === "any")
    where.push(sql`s.${sql(`current_${scope}`)}`);
  // Firestore orders by a field it compares with `>=` before the id, so
  // these sort the list too, after `sortBy`.
  const compared: Fragment[] = [];
  if (query.minEmploymentDate) {
    const latest = sql`s.${sql(`latest_${scope}`)} COLLATE "C"`;
    where.push(sql`${latest} >= ${query.minEmploymentDate}`);
    compared.push(latest);
  }
  if (query.minVotes != null) {
    where.push(sql`s.interesting >= ${query.minVotes}`);
    compared.push(sql`s.interesting`);
  }
  if (query.queueTier != null)
    where.push(
      sql`n.data -> 'stats' -> 'queueTier' = to_jsonb(${query.queueTier}::numeric)`,
    );
  const elections = [...new Set(toArray(query.election))].map((key) =>
    query.electionResult ? electionResultKey(key, query.electionResult) : key,
  );
  if (elections.length > 0)
    where.push(sql`s.${sql(`elections_${scope}`)} && ${elections}::text[]`);
  // Every node has its node_stats row, written with the node: said to the
  // page's query so that the planner may drive it from a node_stats index.
  const hints: Fragment[] = query.type ? [sql`s.type = ${query.type}`] : [];
  const usesStats =
    query.currentlyEmployed === "any" ||
    !!query.minEmploymentDate ||
    query.minVotes != null ||
    elections.length > 0;
  return {
    where,
    hints,
    usesStats,
    compared,
    targetIds,
    from,
    sector,
    seatRegions,
    index,
  };
}

/** The paginated /api/nodes (server/api/nodes/index.get.ts) in one query
 * and one count, every filter in SQL. */
export async function listNodes(
  query: NodeListQuery,
  signedIn: boolean,
): Promise<NodeList | "empty"> {
  const sql = useDb();
  const scope = signedIn ? "all" : "approved";
  const filters = await structuralFilters(sql, query, scope);
  if (filters === "empty") return "empty";
  const { where, hints, compared, from, sector, seatRegions, index } = filters;
  let { targetIds, usesStats } = filters;
  /** Said of the node on `n`, and again on the driving index if any. */
  const onIndex = (said: (alias: "c" | "a") => Fragment) => {
    if (!index) return;
    where.push(said(index.alias));
    index.where.push(said(index.alias));
  };

  // On `s` too, and on the driving index, so that an index of either serves.
  const approved = (yes: boolean) => {
    const not = yes ? sql`` : sql`NOT`;
    where.push(sql`${not} n.is_approved`);
    hints.push(sql`${not} s.is_approved`);
    onIndex((a) => sql`${not} ${sql(a)}.is_approved`);
  };
  if (!signedIn) {
    if (query.visibility === "private") return "empty";
    approved(true);
  } else if (query.visibility === "public") {
    approved(true);
  } else if (query.visibility === "private") {
    approved(false);
  }
  if (query.hideVoted === "no_votes") {
    where.push(sql`NOT coalesce(s.human_voted, false)`);
    usesStats = true;
    onIndex((a) => sql`NOT ${sql(a)}.human_voted`);
  } else if (query.hideVoted === "has_votes") {
    where.push(sql`s.human_voted`);
    usesStats = true;
    onIndex((a) => sql`${sql(a)}.human_voted`);
  }

  // The implicit orders take the direction of the last explicit one, as in
  // Firestore.
  const desc = query.sortBy !== undefined && query.sortDesc === "true";
  const direction = desc ? sql`DESC NULLS LAST` : sql`ASC NULLS FIRST`;
  const keys = [
    ...(query.sortBy
      ? [sortExpression(sql, query.sortBy, scope, !!sector)]
      : []),
    ...compared,
    sql`n.id`,
  ];
  const order = keys.reduce(
    (all, key, i) =>
      i === 0 ? sql`${key} ${direction}` : sql`${all}, ${key} ${direction}`,
    sql``,
  );
  const limit = query.limit ?? null;
  const offset = limit ? ((query.page ?? 1) - 1) * limit : 0;
  const filter = and(sql, where);
  const pageFilter = and(sql, [...where, ...hints]);

  const [rows, [count]] = await Promise.all([
    // The page's ids first and the documents after, so that only the rows
    // on the page are put together: sorting the served documents of 27,509
    // people for ten of them took 185 ms.
    sql<{ id: string; doc: Record<string, unknown> }[]>`
      WITH page AS MATERIALIZED (
        SELECT n.id, row_number() OVER (ORDER BY ${order}) AS ord
        FROM ${from} LEFT JOIN node_stats s ON s.id = n.id LEFT JOIN node_derived d ON d.id = n.id
        WHERE ${pageFilter}
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${offset})
      SELECT n.id, ${servedDoc(sql)} AS doc
      FROM page JOIN nodes n ON n.id = page.id LEFT JOIN node_stats s ON s.id = n.id LEFT JOIN node_derived d ON d.id = n.id
      ORDER BY page.ord`,
    index && indexOnly(query)
      ? sql<{ total: number }[]>`
          SELECT count(*)::int AS total FROM ${index.from}
          WHERE ${and(sql, index.where)}`
      : usesStats
        ? sql<{ total: number }[]>`
          SELECT count(*)::int AS total
          FROM ${from} LEFT JOIN node_stats s ON s.id = n.id
          WHERE ${filter}`
        : // The count of all published people read nodes and node_stats
          // whole, joined (0.6 s at x50); on `n` alone it is an index's.
          sql<{ total: number }[]>`
          SELECT count(*)::int AS total FROM ${from} WHERE ${filter}`,
  ]);
  if (sector) {
    // Which of the sector's places put each row of the page here.
    const ids = rows.map((r) => r.id);
    const hits = await sql<{ id: string }[]>`
      SELECT DISTINCT t.target_id AS id
      FROM node_target t JOIN nodes p ON p.id = t.target_id
      WHERE t.node_id = ANY(${ids}::text[]) AND p.type = 'place' AND NOT p.deleted
        AND EXISTS (SELECT 1 FROM place_categories(p.data -> 'categories') x WHERE x = ${sector})`;
    // Beside the regions a `teryt` filter matched.
    targetIds = [...(targetIds ?? []), ...hits.map((h) => h.id)];
  }
  if (seatRegions) {
    // Which places seated in the regions put each row of the page here
    // (`placeIds` lists them all where the filter meets another).
    const ids = rows.map((r) => r.id);
    const hits = await sql<{ id: string }[]>`
      SELECT DISTINCT e.target AS id
      FROM node_target t JOIN edges e ON e.target = t.target_id
      WHERE t.node_id = ANY(${ids}::text[]) AND e.source = ANY(${seatRegions}::text[])
        AND e.type IN ('seat', 'owns') AND NOT e.deleted AND e.target <> ''
        AND NOT EXISTS (SELECT 1 FROM nodes r
          WHERE r.id = e.target AND r.type = 'region' AND NOT r.deleted)`;
    targetIds = [...(targetIds ?? []), ...hits.map((h) => h.id)];
  }
  return {
    rows: rows.map((r) => toRow(r.id, r.doc)),
    total: count!.total,
    targetIds,
  };
}

/** `fetchNodesByIds` (server/utils/fetch.ts) on Postgres: the served
 * documents, merged-away pages included, in the order the ids were asked. */
export async function readNodesByIds(ids: string[]): Promise<NodeRow[]> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return [];
  const sql = useDb();
  const rows = await sql<{ id: string; doc: Record<string, unknown> }[]>`
    SELECT n.id, ${servedDoc(sql)} AS doc
    FROM nodes n LEFT JOIN node_stats s ON s.id = n.id LEFT JOIN node_derived d ON d.id = n.id
    WHERE n.id = ANY(${wanted}::text[])`;
  const byId = new Map(rows.map((r) => [r.id, toRow(r.id, r.doc)]));
  return wanted.flatMap((id) => byId.get(id) ?? []);
}

/** What to call the places among `ids` (`matchedPlaces` of /api/nodes): a
 * person can be in a sector only through the company their employer is owned
 * by, and their row names the one that brought them in. Region ids are
 * skipped, and drafts for a reader who may not see them. */
export async function placeNamesFromDb(
  ids: string[],
  showDrafts: boolean,
): Promise<Record<string, string>> {
  const wanted = [...new Set(ids)].filter((id) => !id.startsWith("teryt"));
  if (wanted.length === 0) return {};
  const sql = useDb();
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, data ->> 'name' AS name FROM nodes
    WHERE id = ANY(${wanted}::text[]) AND type = 'place' AND NOT deleted
      AND jsonb_typeof(data -> 'name') = 'string'
      AND (${showDrafts} OR is_approved)`;
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/** A page as a picker lists it: a place with its KRS number, an article
 * with its link. */
export type NodeOption = {
  id: string;
  /** Null for an article without a headline. */
  name: string | null;
  krsNumber: string | null;
  url: string | null;
};

/** A place as a picker lists it. */
export type PlaceOption = NodeOption;

/** The most pages one request for options returns. */
export const NODE_OPTIONS_LIMIT = 50;

/** The kinds a picker asks options of (/api/search/places, /api/search/pages). */
export type OptionType = "place" | "article" | "topic";

/** The pages of one kind a picker offers: those whose name holds `q` (the
 * search columns of 0101_a_search.sql), an article also by a link holding
 * `url`, biggest group first; or those `ids` or `krs` name. Never more than
 * NODE_OPTIONS_LIMIT, and only published ones unless `showDrafts`. */
export async function nodeOptions(options: {
  type: OptionType;
  q?: string;
  /** Parts of an article's link, any of which may match. */
  url?: string[];
  ids?: string[];
  krs?: string[];
  showDrafts: boolean;
}): Promise<NodeOption[]> {
  const sql = useDb();
  const ids = [...new Set(options.ids ?? [])].slice(0, NODE_OPTIONS_LIMIT);
  const krs = [...new Set(options.krs ?? [])].slice(0, NODE_OPTIONS_LIMIT);
  const q = options.q?.trim() ?? "";
  const links = [
    ...new Set(
      (options.url ?? [])
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length >= 3),
    ),
  ].slice(0, 4);
  const which: Fragment[] = [];
  if (ids.length) which.push(sql`n.id = ANY(${ids}::text[])`);
  if (krs.length && options.type === "place")
    which.push(sql`n.data ->> 'krsNumber' = ANY(${krs}::text[])
      AND jsonb_typeof(n.data -> 'krsNumber') = 'string'`);
  if (q.length >= 2)
    which.push(sql`n.search_whole LIKE '%' || search_text(${q}) || '%'`);
  if (links.length && options.type === "article")
    which.push(
      sql`lower(jsonb_text(n.data -> 'sourceURL')) LIKE ANY(${links.map(
        (part) => `%${part.replace(/[\\%_]/g, "\\$&")}%`,
      )}::text[])`,
    );
  if (which.length === 0) return [];
  return sql<NodeOption[]>`
    SELECT n.id, jsonb_text(n.data -> 'name') AS name,
      jsonb_text(n.data -> 'krsNumber') AS "krsNumber",
      jsonb_text(n.data -> 'sourceURL') AS url
    FROM nodes n LEFT JOIN node_derived d ON d.id = n.id
    WHERE n.type = ${options.type} AND NOT n.deleted
      AND (jsonb_typeof(n.data -> 'name') = 'string' OR ${options.type === "article"})
      AND (${options.showDrafts} OR n.is_approved)
      AND (${which.reduce((all, part) => sql`${all} OR (${part})`, sql`false`)})
    ORDER BY d.node_group_size DESC NULLS LAST, n.id
    LIMIT ${NODE_OPTIONS_LIMIT}`;
}
