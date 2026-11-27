/**
 * What /admin/oswiadczenia shows, on Postgres: the counts in one statement a
 * table (`count(*) FILTER`), the reading days grouped in SQL, and the lists an
 * admin works through. The rows are drawn by server/utils/declarationOverview.ts.
 */
import { warsawDate } from "../../shared/dates";
import { pageIsPublic } from "../../shared/model";
import {
  candidacyStatuses,
  extractStatuses,
  publicationSetAside,
  type DeclarationOverview,
} from "../../shared/declarations";
import {
  DAYS,
  FAILED_REASONS,
  isoOf,
  LIST_SIZE,
  millisOf,
  NOT_FOUND_REASONS,
  publicationRow,
  reviewRow,
  type OverviewTotals,
  type PersonFacts,
  type StoredDoc,
} from "../utils/declarationOverview";
import { useDb } from "./client";
import { instantOf } from "./editorial";
import { pagesWithAPublicPostPg } from "./publicPosts";
import { textArray } from "./textArray";

type Data = Record<string, unknown>;

/** Counts per code, the rest as `other`, most first. */
function byReason(
  counts: ReadonlyMap<string, number>,
  codes: readonly string[],
  total: number,
): { reason: string; count: number }[] {
  const rows = codes.map((reason) => ({
    reason,
    count: counts.get(reason) ?? 0,
  }));
  const other = total - rows.reduce((sum, row) => sum + row.count, 0);
  return [...rows, ...(other > 0 ? [{ reason: "other", count: other }] : [])]
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
}

type Counted = { key: string | null; n: number };

function countsOf(rows: readonly Counted[]): Map<string, number> {
  return new Map(
    rows.filter((row) => row.key !== null).map((row) => [row.key!, row.n]),
  );
}

/** The counts of the overview: everything but the lists. */
export async function countTotalsPg(
  dailyLimit: number,
  now: Date,
): Promise<OverviewTotals> {
  const sql = useDb();
  const since = new Date(now.getTime() - DAYS * 86_400_000).toISOString();
  const today = warsawDate(now);
  const [
    candidacyStatus,
    candidacyNotFound,
    extractStatus,
    extractFailed,
    pageMatch,
    publicationStatus,
    [answers],
    [people],
    [limit],
    answered,
    settled,
    runs,
  ] = await Promise.all([
    sql<Counted[]>`
      SELECT jsonb_text(data -> 'status') AS key, count(*)::int AS n
      FROM declaration_candidacies GROUP BY 1`,
    sql<Counted[]>`
      SELECT jsonb_text(data -> 'reason') AS key, count(*)::int AS n
      FROM declaration_candidacies WHERE data -> 'status' = '"not_found"'::jsonb GROUP BY 1`,
    sql<Counted[]>`
      SELECT status AS key, count(*)::int AS n FROM declaration_extracts GROUP BY 1`,
    sql<Counted[]>`
      SELECT jsonb_text(data -> 'reason') AS key, count(*)::int AS n
      FROM declaration_extracts WHERE status = 'failed' GROUP BY 1`,
    sql<Counted[]>`
      SELECT jsonb_text(data -> 'pageMatch') AS key, count(*)::int AS n
      FROM declaration_extracts GROUP BY 1`,
    sql<Counted[]>`
      SELECT jsonb_text(data -> 'status') AS key, count(*)::int AS n
      FROM declaration_publications GROUP BY 1`,
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM declaration_answers
      WHERE data -> 'counted' = 'true'::jsonb AND data -> 'votes' = 'true'::jsonb`,
    // How many pages the searches are for, over the first 20,000 candidacies.
    sql<{ n: number }[]>`
      SELECT count(DISTINCT p.id)::int AS n
      FROM (SELECT data FROM declaration_candidacies ORDER BY id LIMIT 20000) c
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(c.data -> 'personIds') = 'array'
             THEN c.data -> 'personIds' ELSE '[]'::jsonb END) AS p(id)`,
    sql<{ count: number | null }[]>`
      SELECT docstore_num(data -> 'count') AS count
      FROM declaration_publish_limits WHERE id = ${today}`,
    // The newest 20,000 answers of the month, the cap keeping today whole.
    sql<{ day: string | null; uid: string | null; voted: boolean }[]>`
      SELECT jsonb_text(data -> 'day') AS day, uid,
        (data -> 'counted' = 'true'::jsonb AND data -> 'votes' = 'true'::jsonb) AS voted
      FROM declaration_answers
      WHERE jsonb_text(data -> 'at') COLLATE "C" >= ${since}
      ORDER BY jsonb_text(data -> 'at') COLLATE "C" DESC, id DESC LIMIT 20000`,
    sql<{ at: unknown }[]>`
      SELECT data #> '{agreed,at}' AS at FROM declaration_extracts
      WHERE jsonb_text(data #> '{agreed,at}') COLLATE "C" >= ${since}
      ORDER BY id LIMIT 20000`,
    sql<{ tag: string; run_id: string | null; at: unknown; n: number }[]>`
      SELECT coalesce(data ->> 'tag', '') AS tag, jsonb_text(data -> 'runId') AS run_id,
        max(jsonb_text(data -> 'updatedAt') COLLATE "C") AS at, count(*)::int AS n
      FROM (SELECT data FROM declaration_extracts
            WHERE jsonb_text(data -> 'updatedAt') IS NOT NULL
            ORDER BY jsonb_text(data -> 'updatedAt') COLLATE "C" DESC, id DESC
            LIMIT 300) recent
      GROUP BY 1, 2`,
  ]);

  const candidacies = countsOf(candidacyStatus);
  const extracts = countsOf(extractStatus);
  const matches = countsOf(pageMatch);
  const publications = countsOf(publicationStatus);
  const byStatus = Object.fromEntries(
    candidacyStatuses.map((s) => [s, candidacies.get(s) ?? 0]),
  ) as Record<(typeof candidacyStatuses)[number], number>;
  const total = (rows: readonly Counted[]) =>
    rows.reduce((sum, row) => sum + row.n, 0);

  const days = new Map<string, { answers: number; settled: number }>();
  for (let i = DAYS - 1; i >= 0; i--) {
    days.set(warsawDate(new Date(now.getTime() - i * 86_400_000)), {
      answers: 0,
      settled: 0,
    });
  }
  const readers = new Set<string>();
  for (const row of answered) {
    if (!row.voted) continue;
    readers.add(String(row.uid));
    const day = days.get(String(row.day));
    if (day) day.answers += 1;
  }
  for (const row of settled) {
    const at = instantOf(row.at);
    const day = at ? days.get(warsawDate(at)) : undefined;
    if (day) day.settled += 1;
  }

  return {
    at: now.toISOString(),
    dailyLimit,
    candidacies: {
      total: total(candidacyStatus),
      people: people?.n ?? 0,
      byStatus,
      notFound: byReason(
        countsOf(candidacyNotFound),
        NOT_FOUND_REASONS,
        byStatus.not_found,
      ),
    },
    extracts: {
      total: total(extractStatus),
      byStatus: Object.fromEntries(
        extractStatuses.map((s) => [s, extracts.get(s) ?? 0]),
      ) as Record<(typeof extractStatuses)[number], number>,
      failed: byReason(
        countsOf(extractFailed),
        FAILED_REASONS,
        extracts.get("failed") ?? 0,
      ),
    },
    readers: {
      answers: answers?.n ?? 0,
      readers: readers.size,
      days: [...days.entries()].map(([day, counts]) => ({ day, ...counts })),
    },
    pages: {
      same: matches.get("same") ?? 0,
      different: matches.get("different") ?? 0,
      noDate: matches.get("no_date") ?? 0,
      confirmed: publications.get("confirmed") ?? 0,
    },
    publications: {
      queued:
        (publications.get("queued") ?? 0) +
        (publications.get("publishing") ?? 0),
      published: publications.get("published") ?? 0,
      today: Number(limit?.count ?? 0),
    },
    runs: runs
      .map((row) => ({
        tag: row.tag,
        runId: row.run_id,
        extracts: row.n,
        at: isoOf(row.at),
      }))
      .sort((a, b) => b.at.localeCompare(a.at)),
  };
}

/** What the overview's rows say of each page. */
export async function peopleByIdPg(
  ids: readonly string[],
): Promise<Map<string, PersonFacts>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await useDb()<{ id: string; data: Data }[]>`
    SELECT id, data FROM nodes WHERE id = ANY(${textArray(wanted)}::text[])`;
  return new Map(
    rows.map(({ id, data }) => [
      id,
      {
        id,
        name: String(data.name ?? id),
        published: pageIsPublic(data),
        birthDate: (data.birthDate as string | undefined) || null,
        gone: data.deleted === true || !!data.merged_into,
      },
    ]),
  );
}

/** The lists an admin works through: what is disputed, what another date
 * contradicts, every hold, and the latest publications. */
export async function reviewListsPg(): Promise<DeclarationOverview["lists"]> {
  const sql = useDb();
  const [disputed, different, held, recent] = await Promise.all([
    sql<StoredDoc[]>`
      SELECT id, data FROM declaration_extracts
      WHERE status = 'disputed' AND jsonb_text(data -> 'updatedAt') IS NOT NULL
      ORDER BY jsonb_text(data -> 'updatedAt') COLLATE "C" DESC, id DESC
      LIMIT ${LIST_SIZE}`,
    sql<StoredDoc[]>`
      SELECT id, data FROM declaration_extracts
      WHERE data -> 'pageMatch' = '"different"'::jsonb
        AND jsonb_text(data -> 'updatedAt') IS NOT NULL
      ORDER BY jsonb_text(data -> 'updatedAt') COLLATE "C" DESC, id DESC
      LIMIT ${LIST_SIZE}`,
    sql<StoredDoc[]>`
      SELECT id, data FROM declaration_publications
      WHERE jsonb_text(data -> 'status') = 'held' ORDER BY id`,
    sql<StoredDoc[]>`
      SELECT id, data FROM declaration_publications
      WHERE jsonb_text(data -> 'status') = 'published'
        AND jsonb_text(data -> 'publishedAt') IS NOT NULL
      ORDER BY jsonb_text(data -> 'publishedAt') COLLATE "C" DESC, id DESC
      LIMIT ${LIST_SIZE}`,
  ]);
  const personIds = (doc: StoredDoc) =>
    Array.isArray(doc.data.personIds) ? (doc.data.personIds as string[]) : [];
  const [people, paid] = await Promise.all([
    peopleByIdPg([
      ...[...disputed, ...different].flatMap(personIds),
      ...[...held, ...recent].map((doc) => doc.id),
    ]),
    pagesWithAPublicPostPg(held.map((doc) => doc.id)),
  ]);
  const rows = held
    .filter((doc) => people.get(doc.id)?.gone !== true)
    .sort((a, b) => millisOf(b.data.queuedAt) - millisOf(a.data.queuedAt))
    .map((doc) => publicationRow(doc, people, paid));
  const declined = rows
    .filter((row) => row.status === "declined")
    .sort((a, b) => b.at.localeCompare(a.at));
  return {
    disputed: disputed.map((doc) => reviewRow(doc, people)),
    different: different.map((doc) => reviewRow(doc, people)),
    held: rows.filter((row) => !publicationSetAside(row)),
    setAside: [
      ...declined,
      ...rows.filter(
        (row) => row.status !== "declined" && publicationSetAside(row),
      ),
    ],
    recent: recent.map((doc) => publicationRow(doc, people)),
  };
}
