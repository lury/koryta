import { useDb } from "./client";
import { and, indexOnly, structuralFilters, type NodeListQuery } from "./nodes";
import type {
  NotesBreakdown,
  PeopleBreakdown,
  PlacesBreakdown,
  PublicationBucket,
  VotesBreakdown,
} from "../utils/databaseStats";
import type { ProgressStats } from "../utils/progressStats";
import { zeroProgress } from "../utils/progressStats";
import type { QueueTierStat } from "../api/stats/queueTiers.get";
import type { RegionStat } from "../utils/regionStats";
import type { HospitalStats } from "../utils/hospitalStats";
import { queueTiers } from "../../shared/queueTiers";

/** A person's counted fields: node_stats where the views have seen the node,
 * the stored `stats` otherwise. */
const isApproved = `coalesce(s.is_approved, jsonb_is_true(n.data #> '{stats,isApproved}'))`;
const humanVoted = `coalesce(s.human_voted, jsonb_is_true(n.data #> '{stats,votes,humanVoted}'))`;
const notesCount = `coalesce((s.stats ->> 'notesCount')::numeric,
  (n.data #>> '{stats,notesCount}')::numeric, 0)`;

/** /api/stats/progress: the six counters over the people the structural
 * filters leave, in one aggregate. Scope `all`, as the Firestore path. */
export async function progressFromDb(
  query: NodeListQuery,
): Promise<ProgressStats> {
  const sql = useDb();
  const filters = await structuralFilters(
    sql,
    { ...query, type: "person" },
    "all",
  );
  if (filters === "empty") return zeroProgress;
  // A sector or a region and nothing else but whether the tie is current:
  // counted on node_categories' or node_areas' index alone.
  const { index } = filters;
  const scoped =
    index && indexOnly(query)
      ? sql`
      SELECT ${sql(index.alias)}.is_approved AS approved,
        ${sql(index.alias)}.human_voted AS voted, ${sql(index.alias)}.noted
      FROM ${index.from} WHERE ${and(sql, index.where)}`
      : sql`
      SELECT ${sql.unsafe(isApproved)} AS approved,
        ${sql.unsafe(humanVoted)} AS voted,
        ${sql.unsafe(notesCount)} > 0 AS noted
      FROM ${filters.from} LEFT JOIN node_stats s ON s.id = n.id
      WHERE ${and(sql, filters.where)}`;
  const [row] = await sql<ProgressStats[]>`
    WITH p AS (${scoped})
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE approved)::int AS approved,
      count(*) FILTER (WHERE NOT approved AND (voted OR noted))::int AS reviewed,
      count(*) FILTER (WHERE NOT approved AND NOT voted AND NOT noted)::int AS "toCheck",
      count(*) FILTER (WHERE voted)::int AS "withVotes",
      count(*) FILTER (WHERE noted)::int AS "withNotes"
    FROM p`;
  return row!;
}

/** /api/stats/queueTiers: per tier, who is left to check and three
 * published examples. */
export async function queueTiersFromDb(): Promise<QueueTierStat[]> {
  const sql = useDb();
  const tierOf = sql`n.data #> '{stats,queueTier}'`;
  const [counts, examples] = await Promise.all([
    sql<{ tier: number; n: number }[]>`
      SELECT (${tierOf})::numeric AS tier, count(*)::int AS n
      FROM nodes n JOIN node_stats s ON s.id = n.id
      WHERE n.type = 'person' AND jsonb_typeof(${tierOf}) = 'number'
        AND NOT s.is_approved AND NOT s.human_voted
      GROUP BY 1`,
    sql<{ tier: number; id: string; name: unknown }[]>`
      SELECT tier, id, name FROM (
        SELECT (${tierOf})::numeric AS tier, n.id, n.data -> 'name' AS name,
          row_number() OVER (PARTITION BY ${tierOf} ORDER BY n.id) AS k
        FROM nodes n
        WHERE n.type = 'person' AND jsonb_typeof(${tierOf}) = 'number'
          AND n.data -> 'published' = 'true') x
      WHERE k <= 3 ORDER BY tier, id`,
  ]);
  return queueTiers.map((tier) => ({
    tier,
    toCheck: counts.find((c) => Number(c.tier) === tier)?.n ?? 0,
    examples: examples
      .filter((e) => Number(e.tier) === tier)
      .map((e) => ({
        id: e.id,
        name: typeof e.name === "string" ? e.name : "",
      })),
  }));
}

/** /api/stats/contributions for one user. */
export async function contributionsFromDb(uid: string) {
  const sql = useDb();
  const [row] = await sql<
    { votes: number; notes: number; revisions: number }[]
  >`
    SELECT (SELECT count(*) FROM votes WHERE user_uid = ${uid})::int AS votes,
      (SELECT count(*) FROM notes WHERE user_uid = ${uid})::int AS notes,
      (SELECT count(*) FROM revisions
        WHERE (data ->> 'update_user') COLLATE "C" = ${uid})::int AS revisions`;
  return row!;
}

/** One document of the `stats` collection, or null where none is stored. */
export async function readStatsDocument(
  id: string,
): Promise<Record<string, unknown> | null> {
  const sql = useDb();
  const [row] = await sql<{ data: Record<string, unknown> }[]>`
    SELECT data FROM stats WHERE id = ${id}`;
  return row?.data ?? null;
}

/** /api/stats/regions: every region's row (`region_people_rows`,
 * 0601_stats_sql.sql), in id order. */
export async function regionStatsFromDb(): Promise<RegionStat[]> {
  const sql = useDb();
  const rows = await sql<{ row: RegionStat }[]>`
    SELECT row FROM region_people_rows ORDER BY id`;
  return rows.map((r) => r.row);
}

/** /api/stats/hospitals on `today` (YYYY-MM-DD, UTC):
 * `hospital_stats`, 0603_hospital_stats.sql. */
export async function hospitalStatsFromDb(
  today: string,
  generatedAt: string,
): Promise<HospitalStats> {
  const sql = useDb();
  const [row] = await sql<{ doc: HospitalStats }[]>`
    SELECT hospital_stats(${today}, ${generatedAt}) AS doc`;
  return row!.doc;
}

export type DatabaseCounts = {
  people: PeopleBreakdown;
  publicationCandidates: PublicationBucket[];
  places: PlacesBreakdown;
  articles: number;
  regions: number;
  edges: number;
  notes: NotesBreakdown;
  revisions: { total: number; unapprovedNodes: number };
  votes: VotesBreakdown;
  extractions: { total: number; reviewed: number };
  comments: number;
};

/** /api/stats/database: the census the last full refresh wrote
 * (`database_count_rows`, 0604_scale_reads.sql), and when. */
export async function databaseStatsFromDb(): Promise<{
  counts: DatabaseCounts;
  at: string;
}> {
  const sql = useDb();
  const [row] = await sql<{ counts: DatabaseCounts; at: Date }[]>`
    SELECT counts, at FROM database_counts`;
  if (!row)
    throw new Error("database_counts is empty: run refresh_node_stats()");
  return { counts: row.counts, at: row.at.toISOString() };
}
