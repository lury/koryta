import type postgres from "postgres";
import type {
  NotesBreakdown,
  PeopleBreakdown,
  PlacesBreakdown,
  PublicationBucket,
  VotesBreakdown,
} from "~~/server/utils/databaseStats";
import { VOTE_SCALE } from "~~/server/utils/databaseStats";
import type { DatabaseCounts } from "~~/server/db/stats";

type Db = postgres.Sql;

/** A person's counted fields: node_stats where the views have seen the node,
 * the stored `stats` otherwise. */
const isApproved = `coalesce(s.is_approved, jsonb_is_true(n.data #> '{stats,isApproved}'))`;
const humanVoted = `coalesce(s.human_voted, jsonb_is_true(n.data #> '{stats,votes,humanVoted}'))`;
const notesCount = `coalesce((s.stats ->> 'notesCount')::numeric,
  (n.data #>> '{stats,notesCount}')::numeric, 0)`;

/** /api/stats/database as server/db/stats.ts counted it per request before
 * 0604_scale_reads.sql: the oracle of `database_count_rows`. */
export async function countDatabase(sql: Db): Promise<DatabaseCounts> {
  const [people, candidates, places, counts, notes, votes] = await Promise.all([
    peopleBreakdown(sql),
    publicationCandidates(sql),
    placesBreakdown(sql),
    sql<
      {
        articles: number;
        regions: number;
        edges: number;
        revisions: number;
        unapproved: number;
        extractions: number;
        reviewed: number;
        comments: number;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM nodes WHERE type = 'article')::int AS articles,
        (SELECT count(*) FROM nodes WHERE type = 'region')::int AS regions,
        (SELECT count(*) FROM edges)::int AS edges,
        (SELECT count(*) FROM revisions)::int AS revisions,
        (SELECT count(*) FROM nodes
          WHERE data #> '{revisions,has_unapproved}' = 'true')::int AS unapproved,
        (SELECT count(*) FROM extractions)::int AS extractions,
        (SELECT count(*) FROM extractions
          WHERE data #> '{stats,votes,humanVoted}' = 'true')::int AS reviewed,
        (SELECT count(*) FROM comments)::int AS comments`,
    notesBreakdown(sql),
    votesBreakdown(sql),
  ]);
  const c = counts[0]!;
  return {
    people,
    publicationCandidates: candidates,
    places,
    articles: c.articles,
    regions: c.regions,
    edges: c.edges,
    notes,
    revisions: { total: c.revisions, unapprovedNodes: c.unapproved },
    votes,
    extractions: { total: c.extractions, reviewed: c.reviewed },
    comments: c.comments,
  };
}

/** `bucketPeople` over every person node, merged-away ones too, as the
 * Firestore read of `type == person` has them. */
async function peopleBreakdown(sql: Db): Promise<PeopleBreakdown> {
  const [row] = await sql<PeopleBreakdown[]>`
    WITH p AS (
      SELECT ${sql.unsafe(isApproved)} AS approved,
        ${sql.unsafe(humanVoted)} AS voted,
        ${sql.unsafe(notesCount)} > 0 AS noted,
        coalesce(s.experience_all,
          (n.data #>> '{stats,edges,all,experienceMonths}')::numeric, 0) > 0 AS public_job,
        coalesce(s.current_all,
          jsonb_is_true(n.data #> '{stats,edges,all,currentlyEmployed}')) AS current
      FROM nodes n LEFT JOIN node_stats s ON s.id = n.id
      WHERE n.type = 'person')
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE approved)::int AS approved,
      count(*) FILTER (WHERE NOT approved AND (voted OR noted))::int AS reviewed,
      count(*) FILTER (WHERE NOT approved AND NOT voted AND NOT noted)::int AS "toCheck",
      count(*) FILTER (WHERE voted)::int AS "withVotes",
      count(*) FILTER (WHERE noted)::int AS "withNotes",
      count(*) FILTER (WHERE public_job)::int AS "withPublicEmployment",
      count(*) FILTER (WHERE current)::int AS "currentlyEmployed"
    FROM p`;
  return row!;
}

/** `bucketPublicationCandidates`: people by their summed score, 1..4 and an
 * open bucket from 5. */
async function publicationCandidates(sql: Db): Promise<PublicationBucket[]> {
  const rows = await sql<
    { floor: number; approved: number; pending: number }[]
  >`
    WITH p AS (
      SELECT ${sql.unsafe(isApproved)} AS approved,
        coalesce(s.interesting,
          (n.data #>> '{stats,votes,interesting}')::numeric, 0) AS score
      FROM nodes n LEFT JOIN node_stats s ON s.id = n.id
      WHERE n.type = 'person')
    SELECT least(trunc(score), 5)::int AS floor,
      count(*) FILTER (WHERE approved)::int AS approved,
      count(*) FILTER (WHERE NOT approved)::int AS pending
    FROM p WHERE score >= 1 GROUP BY 1`;
  return [1, 2, 3, 4, 5].map((floor) => {
    const row = rows.find((r) => r.floor === floor);
    return {
      floor,
      open: floor === 5,
      approved: row?.approved ?? 0,
      pending: row?.pending ?? 0,
    };
  });
}

async function placesBreakdown(sql: Db): Promise<PlacesBreakdown> {
  const [row] = await sql<PlacesBreakdown[]>`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE data -> 'isPublic' = 'true')::int AS "publicSector",
      count(*) FILTER (WHERE data -> 'isPublic' IS DISTINCT FROM 'true'
        AND data -> 'isPublicSource' = '"manual"')::int AS "confirmedPrivate",
      count(*) FILTER (WHERE data -> 'isPublic' IS DISTINCT FROM 'true'
        AND data -> 'isPublicSource' IS DISTINCT FROM '"manual"')::int AS unknown
    FROM nodes WHERE type = 'place'`;
  return row!;
}

/** `bucketNotes`: one row per entry inside a note. */
async function notesBreakdown(sql: Db): Promise<NotesBreakdown> {
  const [row] = await sql<
    (Omit<NotesBreakdown, "byKind"> & {
      source: number;
      change_request: number;
      missing: number;
    })[]
  >`
    WITH e AS (
      SELECT coalesce(jsonb_text(x -> 'kind'), 'source') AS kind,
        jsonb_text(x -> 'adminStatus') AS status
      FROM notes, jsonb_array_elements(CASE WHEN jsonb_typeof(data -> 'sources') = 'array'
        THEN data -> 'sources' ELSE '[]' END) x)
    SELECT (SELECT count(*) FROM notes)::int AS notes,
      (SELECT count(DISTINCT node_id) FROM notes WHERE node_id <> '')::int AS "annotatedNodes",
      count(*)::int AS sources,
      count(*) FILTER (WHERE kind = 'source')::int AS source,
      count(*) FILTER (WHERE kind = 'change_request')::int AS change_request,
      count(*) FILTER (WHERE kind = 'missing')::int AS missing,
      count(*) FILTER (WHERE status = 'unresolved')::int AS unresolved,
      count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
      count(*) FILTER (WHERE status IS DISTINCT FROM 'unresolved'
        AND status IS DISTINCT FROM 'resolved')::int AS untriaged
    FROM e`;
  const { source, change_request, missing, ...rest } = row!;
  return { ...rest, byKind: { source, change_request, missing } };
}

/** `bucketVotes`: people's votes only, the pipeline's left out. */
async function votesBreakdown(sql: Db): Promise<VotesBreakdown> {
  const [[row], steps] = await Promise.all([
    sql<Omit<VotesBreakdown, "distribution">[]>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE coalesce(extraction_id, '') = '')::int AS "onNodes",
        count(*) FILTER (WHERE coalesce(extraction_id, '') <> '')::int AS "onExtractions",
        count(DISTINCT user_uid)::int AS voters,
        count(*) FILTER (WHERE coalesce(jsonb_text(data -> 'comment'), '') <> '')::int AS "withComment"
      FROM votes WHERE strpos(coalesce(user_uid, ''), 'pipeline') = 0`,
    sql<{ category: string; step: number; n: number }[]>`
      SELECT c.key AS category,
        greatest(-5, least(5, trunc((c.value #>> '{}')::numeric)))::int AS step,
        count(*)::int AS n
      FROM votes v, jsonb_each(CASE WHEN jsonb_typeof(v.data -> 'categoryVotes') = 'object'
        THEN v.data -> 'categoryVotes' ELSE '{}' END) c
      WHERE strpos(coalesce(v.user_uid, ''), 'pipeline') = 0
        AND c.key IN ('interesting', 'quality') AND jsonb_typeof(c.value) = 'number'
      GROUP BY 1, 2`,
  ]);
  const distribution: Record<string, Record<string, number>> = {};
  for (const category of ["interesting", "quality"]) {
    distribution[category] = Object.fromEntries(
      VOTE_SCALE.map((step) => [
        String(step),
        steps.find((s) => s.category === category && s.step === step)?.n ?? 0,
      ]),
    );
  }
  return { ...row!, distribution };
}
