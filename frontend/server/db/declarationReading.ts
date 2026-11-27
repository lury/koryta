/**
 * The readers' side of the declarations on Postgres: the queue of crops, an
 * answer and what it settles, a claim of a browser's answers, a reader's
 * finds and progress. The rules are the ones server/utils/declarations.ts
 * describes; the reads and writes are explicit SQL here (decision on
 * 2026-11-26), with row locks where Firestore took a transaction.
 */
import { createError } from "h3";
import { warsawDate } from "../../shared/dates";
import {
  agreedName,
  answerVotes,
  FOUND_LIST_LIMIT,
  READ_NAMES,
  settledStatuses,
  settleReading,
  type DeclarationAnswer,
  type DeclarationFind,
  type DeclarationFinds,
  type DeclarationPeople,
  type DeclarationQueue,
  type DeclarationTask,
  type ReaderAnswer,
  type Settlement,
} from "../../shared/declarations";
import { pageIsPublic } from "../../shared/model";
import type { DecodedIdToken } from "firebase-admin/auth";
import {
  anonymousUid,
  answerId,
  CLAIM_LIMIT,
  isCountedReader,
  READER_DAILY_LIMIT,
  ROOM_SHARDS,
  VOTELESS_ASK_DAILY_LIMIT,
  VOTELESS_DAILY_LIMIT,
  type ClaimedAnswers,
  type DeclarationReader,
  type RecordedAnswer,
} from "../utils/declarations";
import { unitOf } from "../utils/declarationMatch";
import { PEOPLE_DOC, parseDeclarationPeople } from "../utils/declarationPeople";
import { useDb, type Db } from "./client";
import { resolveMergedNodeDoc } from "./graph";
import { textArray } from "./textArray";
import type postgres from "postgres";

type Data = Record<string, unknown>;
type Sql = Db | postgres.TransactionSql;
type Row = { id: string; data: Data };

/** The rooms of `declaration_reader_limits` for readers without a vote. */
const VOTELESS_ANSWERS = "voteless-answers";
const VOTELESS_ASKS = "voteless-asks";

/** Crops a claim moves at once, each in a transaction of its own. Below the
 * pool's five connections, so a claim leaves room for other requests. */
const CLAIM_CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// Day counters
// ---------------------------------------------------------------------------

/** One more on a day's counter while it is under `cap`; whether it was. */
export async function takeCount(
  sql: Sql,
  table: "declaration_reader_limits" | "declaration_publish_limits",
  id: string,
  day: string,
  cap: number,
  extra: Data = {},
): Promise<boolean> {
  const [row] = await sql<{ taken: string | null }[]>`
    SELECT declaration_take_count(${table}::regclass, ${id}, ${day}, ${cap},
      ${sql.json(extra as never)}::jsonb)::text AS taken`;
  return row?.taken !== null && row?.taken !== undefined;
}

/** The shards of a day's room for readers without a vote, from a random one. */
function roomIds(name: string, day: string): string[] {
  const start = Math.floor(Math.random() * ROOM_SHARDS);
  return Array.from(
    { length: ROOM_SHARDS },
    (_, i) => `${day}_${name}_${(start + i) % ROOM_SHARDS}`,
  );
}

/** Takes one from a day's room, the shards from a random one on; false once
 * every share is full. */
async function takeRoom(
  sql: Sql,
  name: string,
  day: string,
  limit: number,
): Promise<boolean> {
  const share = Math.ceil(limit / ROOM_SHARDS);
  for (const id of roomIds(name, day)) {
    if (await takeCount(sql, "declaration_reader_limits", id, day, share)) {
      return true;
    }
  }
  return false;
}

/** Whether a day's room has space in any share, without taking any. */
async function roomLeft(
  sql: Sql,
  name: string,
  day: string,
  limit: number,
): Promise<boolean> {
  const share = Math.ceil(limit / ROOM_SHARDS);
  const ids = roomIds(name, day);
  const rows = await sql<{ id: string; count: number | null }[]>`
    SELECT id, docstore_num(data -> 'count') AS count
    FROM declaration_reader_limits WHERE id = ANY(${textArray(ids)}::text[])`;
  const used = new Map(rows.map((row) => [row.id, Number(row.count ?? 0)]));
  return ids.some((id) => (used.get(id) ?? 0) < share);
}

function votelessRefusal(reader: DeclarationReader) {
  return createError({
    statusCode: 429,
    message: reader.anonymous
      ? "Na dziś przyjęliśmy już tyle odczytów bez konta, ile możemy. Zaloguj się albo załóż konto, żeby czytać dalej."
      : "Na dziś przyjęliśmy już tyle odczytów bez potwierdzonego adresu e-mail, ile możemy. Potwierdź adres (link przyszedł po rejestracji), żeby czytać dalej.",
  });
}

/** `admitToQueue`: a reader without a vote asks while the day has room both
 * for their answers and for their asking; the ask is counted. */
export async function admitToQueuePg(
  reader: DeclarationReader,
  now: Date = new Date(),
): Promise<void> {
  if (reader.votes) return;
  const sql = useDb();
  const day = warsawDate(now);
  const [answersLeft, asked] = await Promise.all([
    roomLeft(sql, VOTELESS_ANSWERS, day, VOTELESS_DAILY_LIMIT),
    takeRoom(sql, VOTELESS_ASKS, day, VOTELESS_ASK_DAILY_LIMIT),
  ]);
  if (!answersLeft || !asked) throw votelessRefusal(reader);
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/** Stored bytes (`{"$bytes": base64}`) as the data URL a page draws. */
export function dataUrlOf(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && !Buffer.isBuffer(value)) {
    const b64 = (value as { $bytes?: unknown }).$bytes;
    return typeof b64 === "string" && b64
      ? `data:image/png;base64,${b64}`
      : null;
  }
  const buffer = Buffer.isBuffer(value)
    ? value
    : Buffer.from(value as Uint8Array);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** A crop as a reader gets it (`taskOf`). */
function taskOf(
  id: string,
  data: Data,
  images: Data | undefined,
): DeclarationTask | null {
  const date = dataUrlOf(images?.date);
  if (!date) return null;
  const size = (data.imageSize ?? {}) as {
    date?: { width: number; height: number };
    name?: { width: number; height: number } | null;
  };
  return {
    id,
    ...unitOf(data),
    declarationYear: (data.declarationYear as number | undefined) ?? null,
    documentUrl: String(data.url ?? ""),
    host: (data.host as string | null) ?? null,
    images: { date, name: READ_NAMES ? dataUrlOf(images?.name) : null },
    imageSize: {
      date: size.date ?? { width: 0, height: 0 },
      name: READ_NAMES ? (size.name ?? null) : null,
    },
  };
}

function personIdsOf(data: Data): string[] {
  const ids = data.personIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string" && id !== "")
    : [];
}

type QueueRow = {
  id: string;
  data: Data;
  priority: number;
  answer_count: number;
  rand: number;
  answered: boolean;
};

/** `nextTasks`: open crops by priority, the ones a vote short first, then at
 * random, a page of 40 at a time past a keyset cursor, one crop a person. */
export async function nextTasksPg(
  uid: string,
  count: number,
  exclude: ReadonlySet<string> = new Set(),
  people: ReadonlySet<string> = new Set(),
): Promise<DeclarationTask[]> {
  const sql = useDb();
  const picked: Row[] = [];
  const inHand = new Set(people);
  let cursor: QueueRow | undefined;
  for (let page = 0; page < 6 && picked.length < count; page++) {
    const after = cursor
      ? sql`AND (e.priority > ${cursor.priority}
          OR (e.priority = ${cursor.priority} AND e.answer_count < ${cursor.answer_count})
          OR (e.priority = ${cursor.priority} AND e.answer_count = ${cursor.answer_count}
              AND e.rand > ${cursor.rand})
          OR (e.priority = ${cursor.priority} AND e.answer_count = ${cursor.answer_count}
              AND e.rand = ${cursor.rand} AND e.id > ${cursor.id}))`
      : sql``;
    const rows = await sql<QueueRow[]>`
      SELECT e.id, e.data, e.priority, e.answer_count, e.rand,
        EXISTS (SELECT 1 FROM declaration_answers a
                WHERE a.id = e.id || '_' || ${uid}) AS answered
      FROM declaration_extracts e
      WHERE e.status = 'open' AND e.priority IS NOT NULL
        AND e.answer_count IS NOT NULL AND e.rand IS NOT NULL ${after}
      ORDER BY e.priority ASC, e.answer_count DESC, e.rand ASC, e.id ASC
      LIMIT 40`;
    if (rows.length === 0) break;
    cursor = rows.at(-1);
    for (const row of rows) {
      if (exclude.has(row.id) || row.answered) {
        for (const id of personIdsOf(row.data)) inHand.add(id);
      }
    }
    for (const row of rows) {
      if (picked.length >= count) break;
      if (exclude.has(row.id) || row.answered) continue;
      const its = personIdsOf(row.data);
      if (its.length > 0 && its.every((id) => inHand.has(id))) continue;
      for (const id of its) inHand.add(id);
      picked.push(row);
    }
  }
  if (picked.length === 0) return [];
  const images = await sql<Row[]>`
    SELECT id, data FROM declaration_extract_images
    WHERE id = ANY(${textArray(picked.map((row) => row.id))}::text[])`;
  const byId = new Map(images.map((row) => [row.id, row.data]));
  return picked
    .map((row) => taskOf(row.id, row.data, byId.get(row.id)))
    .filter((task): task is DeclarationTask => task !== null);
}

/** `queueFor`: the next crops and the counts around them. */
export async function queueForPg(
  uid: string,
  count: number,
  exclude: ReadonlySet<string> = new Set(),
  people: ReadonlySet<string> = new Set(),
): Promise<DeclarationQueue> {
  const sql = useDb();
  const today = warsawDate();
  const [tasks, [counts]] = await Promise.all([
    nextTasksPg(uid, count, exclude, people),
    sql<
      {
        open: number;
        settled: number;
        total: number;
        today: number;
        found: number;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM declaration_extracts WHERE status = 'open')::int AS open,
        (SELECT count(*) FROM declaration_extracts
          WHERE status = ANY(${textArray([...settledStatuses])}::text[]))::int AS settled,
        (SELECT count(*) FROM declaration_answers
          WHERE uid = ${uid} AND data -> 'counted' = 'true'::jsonb)::int AS total,
        (SELECT count(*) FROM declaration_answers
          WHERE uid = ${uid} AND data -> 'counted' = 'true'::jsonb
            AND data -> 'day' = to_jsonb(${today}::text))::int AS today,
        (SELECT count(*) FROM declaration_reader_finds
          WHERE data @> ${sql.json({ uid })})::int AS found`,
  ]);
  return {
    task: tasks[0] ?? null,
    upcoming: tasks.slice(1),
    open: counts!.open,
    settledCrops: counts!.settled,
    mine: { total: counts!.total, today: counts!.today, found: counts!.found },
  };
}

/** `settledWithReader`: settled crops carrying a reading of this reader's
 * that voted. */
export async function settledWithReaderPg(uid: string): Promise<number> {
  const [row] = await useDb()<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM declaration_answers a
    JOIN declaration_extracts e ON e.id = jsonb_text(a.data -> 'extractId')
    WHERE a.uid = ${uid}
      AND a.data -> 'counted' = 'true'::jsonb AND a.data -> 'votes' = 'true'::jsonb
      AND e.status = ANY(${textArray([...settledStatuses])}::text[])`;
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Answers and what they settle
// ---------------------------------------------------------------------------

/** What a crop's answers add up to, kept on the crop. */
function summaryOf(answers: readonly ReaderAnswer[]) {
  const readings: Record<string, number> = {};
  let unreadable = 0;
  let empty = 0;
  for (const answer of answers) {
    if (answer.verdict === "date" && answer.value) {
      readings[answer.value] = (readings[answer.value] ?? 0) + 1;
    } else if (answer.verdict === "unreadable" || answer.verdict === "skip") {
      unreadable += 1;
    } else if (answer.verdict === "empty") empty += 1;
  }
  return { readings, unreadable, empty };
}

function isVotingReading(answer: ReaderAnswer): boolean {
  return answer.verdict !== "skip" && answerVotes(answer);
}

/** A crop's answers that vote, under the transaction's lock on the crop. */
async function votingAnswersTo(
  sql: Sql,
  extractId: string,
): Promise<ReaderAnswer[]> {
  const rows = await sql<{ data: ReaderAnswer }[]>`
    SELECT data FROM declaration_answers
    WHERE extract_id = ${extractId} AND data -> 'votes' = 'true'::jsonb`;
  return rows.map((row) => row.data);
}

/** `writeSettlement`: the counts on the crop every time, and what they settle
 * while it is open. The settlement when the answers close the crop. */
async function writeSettlement(
  tx: postgres.TransactionSql,
  extractId: string,
  data: Data,
  answers: readonly ReaderAnswer[],
  now: Date,
): Promise<Settlement | null> {
  const voting = answers.filter(answerVotes);
  const settlement = data.status === "open" ? settleReading(voting) : null;
  const settled =
    settlement !== null && settlement.status !== "open" ? settlement : null;
  const at = now.toISOString();
  const patch: Data = {
    answerCount: voting.length,
    answers: summaryOf(voting),
    updatedAt: at,
    ...(settled
      ? {
          status: settled.status,
          agreed:
            settled.status === "agreed"
              ? {
                  value: settled.value,
                  kind: settled.kind,
                  by: "readers",
                  readers: settled.readers,
                  at,
                }
              : null,
          agreedName: agreedName(voting),
        }
      : {}),
  };
  await tx`
    UPDATE declaration_extracts
    SET data = data || ${tx.json(patch as never)}::jsonb, updated_at = clock_timestamp()
    WHERE id = ${extractId}`;
  return settled;
}

/** `recordAnswer`: the answer stored and, when it votes, the crop settled if
 * the answers agree, in one transaction under the crop's row lock. */
export async function recordAnswerPg(args: {
  extractId: string;
  reader: DeclarationReader;
  answer: DeclarationAnswer;
  now?: Date;
}): Promise<RecordedAnswer> {
  const now = args.now ?? new Date();
  const day = warsawDate(now);
  const { reader } = args;
  const { uid, votes } = reader;
  const counted = args.answer.verdict !== "skip";
  const limited = counted || votes;
  let result: RecordedAnswer;
  await useDb().begin(async (tx) => {
    const [extract] = votes
      ? await tx<{ data: Data }[]>`
          SELECT data FROM declaration_extracts WHERE id = ${args.extractId} FOR UPDATE`
      : await tx<{ data: Data }[]>`
          SELECT data FROM declaration_extracts WHERE id = ${args.extractId}`;
    const data = extract?.data;
    if (!data || data.status === "failed" || data.status === "withdrawn") {
      throw createError({
        statusCode: 404,
        message: "Nie ma takiego wycinka.",
      });
    }
    if (
      limited &&
      !(await takeCount(
        tx,
        "declaration_reader_limits",
        `${day}_${uid}`,
        day,
        READER_DAILY_LIMIT,
      ))
    ) {
      throw createError({
        statusCode: 429,
        message: "Na dziś wystarczy - dziękujemy! Wróć jutro.",
      });
    }
    if (
      !votes &&
      !(await takeRoom(tx, VOTELESS_ANSWERS, day, VOTELESS_DAILY_LIMIT))
    ) {
      throw votelessRefusal(reader);
    }
    const others = votes ? await votingAnswersTo(tx, args.extractId) : null;
    const mine: ReaderAnswer = {
      uid,
      verdict: args.answer.verdict,
      value: args.answer.value ?? null,
      name: args.answer.name?.trim() || null,
      votes,
    };
    const doc = {
      extractId: args.extractId,
      uid,
      verdict: mine.verdict,
      value: mine.value,
      name: mine.name,
      votes,
      counted,
      day,
      imageHash: data.imageHash ?? null,
      at: now.toISOString(),
    };
    await tx`
      INSERT INTO declaration_answers (id, data)
      VALUES (${answerId(args.extractId, uid)}, ${tx.json(doc as never)})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = clock_timestamp()`;
    result = {
      settled: others
        ? await writeSettlement(
            tx,
            args.extractId,
            data,
            [...others.filter((answer) => answer.uid !== uid), mine],
            now,
          )
        : null,
      personIds: Array.isArray(data.personIds)
        ? data.personIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  });
  return result!;
}

// ---------------------------------------------------------------------------
// A claim of a browser's answers
// ---------------------------------------------------------------------------

/** `claimAnswers`: a browser's answers onto the account that signed in
 * there, within the account's daily limits, a transaction a crop. */
export async function claimAnswersPg(args: {
  readerId: string;
  user: DecodedIdToken;
  now?: Date;
}): Promise<ClaimedAnswers> {
  const sql = useDb();
  const now = args.now ?? new Date();
  const from = anonymousUid(args.readerId);
  const to = args.user.uid;
  if (!isCountedReader(args.user)) {
    const [reading] = await sql`
      SELECT 1 FROM declaration_answers
      WHERE uid = ${from} AND data -> 'counted' = 'true'::jsonb LIMIT 1`;
    if (!reading) return { claimed: 0, settled: [], left: 0 };
    throw createError({
      statusCode: 403,
      message:
        "Potwierdź adres e-mail (link przyszedł po rejestracji), a odczyty z tej przeglądarki przejdą na Twoje konto.",
    });
  }
  const theirs = await sql<{ data: Data }[]>`
    SELECT data FROM declaration_answers WHERE uid = ${from}
    ORDER BY id LIMIT ${CLAIM_LIMIT}`;
  const listed = theirs.flatMap(({ data }) => {
    const extractId = data.extractId;
    if (typeof extractId !== "string" || extractId === "") return [];
    return [
      {
        extractId,
        day: String(data.day ?? warsawDate(now)),
        counted: data.counted === true,
      },
    ];
  });
  const result: ClaimedAnswers = { claimed: 0, settled: [], left: 0 };
  if (listed.length === 0) {
    await moveFinds(from, to);
    return result;
  }

  const wanted = new Map<string, number>();
  for (const answer of listed) {
    if (answer.counted)
      wanted.set(answer.day, (wanted.get(answer.day) ?? 0) + 1);
  }
  const room = await takeVotes(to, wanted);
  const plan = listed.map((answer) => {
    if (!answer.counted) return { ...answer, votes: true };
    const left = room.get(answer.day) ?? 0;
    room.set(answer.day, left - 1);
    return { ...answer, votes: left > 0 };
  });

  const unused = new Map<string, number>();
  const giveBack = (answer: (typeof plan)[number]) => {
    if (answer.counted && answer.votes) {
      unused.set(answer.day, (unused.get(answer.day) ?? 0) + 1);
    }
  };
  const move = async (answer: (typeof plan)[number]) => {
    const { moved, settled } = await claimAnswer({
      extractId: answer.extractId,
      from,
      to,
      votes: answer.votes,
      now,
    });
    if (moved) result.claimed += 1;
    else giveBack(answer);
    if (settled) {
      result.settled.push({ extractId: answer.extractId, settlement: settled });
    }
  };

  const failed: typeof plan = [];
  for (let i = 0; i < plan.length; i += CLAIM_CONCURRENCY) {
    const batch = plan.slice(i, i + CLAIM_CONCURRENCY);
    const outcomes = await Promise.allSettled(batch.map(move));
    outcomes.forEach((outcome, j) => {
      if (outcome.status === "rejected") failed.push(batch[j]!);
    });
  }
  for (const [i, answer] of failed.entries()) {
    try {
      await move(answer);
    } catch (error) {
      console.error(
        `[declarations] claiming ${answer.extractId} failed twice, ${failed.length - i} answers left for the next claim`,
        error,
      );
      const left = failed.slice(i);
      left.forEach(giveBack);
      result.left = left.length;
      break;
    }
  }
  await giveBackVotes(to, unused);
  await moveFinds(from, to);
  return result;
}

/** The finds of a browser go to the account, once per person: one statement. */
async function moveFinds(from: string, to: string): Promise<void> {
  const sql = useDb();
  await sql`
    WITH moved AS (
      DELETE FROM declaration_reader_finds WHERE data @> ${sql.json({ uid: from })}
      RETURNING data)
    INSERT INTO declaration_reader_finds (id, data)
    SELECT ${to} || '_' || (data ->> 'personId'), data || jsonb_build_object('uid', ${to}::text)
    FROM moved WHERE coalesce(data ->> 'personId', '') <> ''
    ON CONFLICT (id) DO UPDATE
      SET data = declaration_reader_finds.data || EXCLUDED.data, updated_at = clock_timestamp()`;
}

/** Takes from the account's daily limits the votes a claim gives, in one
 * transaction under the limits' row locks; how many may vote, by day. */
async function takeVotes(
  uid: string,
  wanted: ReadonlyMap<string, number>,
): Promise<Map<string, number>> {
  const granted = new Map<string, number>();
  if (wanted.size === 0) return granted;
  await useDb().begin(async (tx) => {
    for (const [day, want] of [...wanted].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const id = `${day}_${uid}`;
      await tx`
        INSERT INTO declaration_reader_limits (id, data)
        VALUES (${id}, jsonb_build_object('count', 0, 'day', ${day}::text))
        ON CONFLICT (id) DO NOTHING`;
      const [row] = await tx<{ count: number | null }[]>`
        SELECT docstore_num(data -> 'count') AS count FROM declaration_reader_limits
        WHERE id = ${id} FOR UPDATE`;
      const used = Number(row?.count ?? 0);
      const take = Math.min(want, Math.max(0, READER_DAILY_LIMIT - used));
      granted.set(day, take);
      if (take > 0) {
        await tx`
          UPDATE declaration_reader_limits
          SET data = data || jsonb_build_object('count', ${used + take}::numeric, 'day', ${day}::text),
              updated_at = clock_timestamp()
          WHERE id = ${id}`;
      }
    }
  });
  return granted;
}

/** Gives back what a claim took for answers it did not move. */
async function giveBackVotes(
  uid: string,
  unused: ReadonlyMap<string, number>,
): Promise<void> {
  const sql = useDb();
  for (const [day, count] of unused) {
    await sql`
      INSERT INTO declaration_reader_limits AS t (id, data)
      VALUES (${`${day}_${uid}`}, jsonb_build_object('count', ${-count}::numeric, 'day', ${day}::text))
      ON CONFLICT (id) DO UPDATE SET data = t.data || jsonb_build_object(
        'count', coalesce(docstore_num(t.data -> 'count'), 0) - ${count}, 'day', ${day}::text),
        updated_at = clock_timestamp()`;
  }
}

/** One crop of a claim (`claimAnswer`), under the locks of the crop and both
 * answers. */
async function claimAnswer(args: {
  extractId: string;
  from: string;
  to: string;
  votes: boolean;
  now: Date;
}): Promise<{ moved: boolean; settled: Settlement | null }> {
  const { extractId, from, to, now } = args;
  const fromId = answerId(extractId, from);
  const toId = answerId(extractId, to);
  let outcome: { moved: boolean; settled: Settlement | null };
  await useDb().begin(async (tx) => {
    const [extract] = await tx<{ data: Data }[]>`
      SELECT data FROM declaration_extracts WHERE id = ${extractId} FOR UPDATE`;
    const answers = await tx<Row[]>`
      SELECT id, data FROM declaration_answers
      WHERE id = ANY(${textArray([fromId, toId])}::text[]) ORDER BY id FOR UPDATE`;
    const theirs = answers.find((row) => row.id === fromId)?.data;
    const own = answers.find((row) => row.id === toId)?.data;
    if (!theirs) {
      outcome = { moved: false, settled: null };
      return;
    }
    const data = extract?.data;
    const answer = theirs as ReaderAnswer & { imageHash?: string | null };
    const moved = {
      ...answer,
      uid: to,
      votes: args.votes,
      claimedFrom: from,
      claimedAt: now.toISOString(),
    } as ReaderAnswer & Data;
    const outdated =
      data !== undefined &&
      (answer.imageHash ?? null) !== (data.imageHash ?? null);
    const ownStands =
      own !== undefined &&
      (isVotingReading(own as ReaderAnswer) || !isVotingReading(moved));
    await tx`DELETE FROM declaration_answers WHERE id = ${fromId}`;
    if (outdated || ownStands) {
      outcome = { moved: false, settled: null };
      return;
    }
    const voting =
      data && isVotingReading(moved)
        ? await votingAnswersTo(tx, extractId)
        : null;
    await tx`
      INSERT INTO declaration_answers (id, data) VALUES (${toId}, ${tx.json(moved as never)})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = clock_timestamp()`;
    outcome = {
      moved: true,
      settled:
        data && voting
          ? await writeSettlement(
              tx,
              extractId,
              data,
              [...voting.filter((other) => other.uid !== to), moved],
              now,
            )
          : null,
    };
  });
  return outcome!;
}

// ---------------------------------------------------------------------------
// What a reader found, the crop's pictures, the people count
// ---------------------------------------------------------------------------

/** `findsOf`: the newest finds of a reader with the declaration that found
 * each, a page merged since listed as the page it went into, once. */
export async function findsOfPg(uid: string): Promise<DeclarationFinds> {
  const sql = useDb();
  const [newest, [total]] = await Promise.all([
    sql<{ data: Data }[]>`
      SELECT data FROM declaration_reader_finds
      WHERE jsonb_text(data -> 'uid') = ${uid} AND data ? 'at'
      ORDER BY jsonb_text(data -> 'at') COLLATE "C" DESC, id DESC
      LIMIT ${FOUND_LIST_LIMIT}`,
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM declaration_reader_finds
      WHERE data @> ${sql.json({ uid })}`,
  ]);
  const finds = newest.map((row) => row.data);
  const totalCount = total?.n ?? 0;
  if (finds.length === 0) return { people: [], total: totalCount };
  const extractIds = finds.map((find) => String(find.extractId ?? ""));
  const wanted = [...new Set(extractIds.filter(Boolean))];
  const [pages, extracts] = await Promise.all([
    Promise.all(
      finds.map((find) => resolveMergedNodeDoc(String(find.personId))),
    ),
    wanted.length > 0
      ? sql<Row[]>`
          SELECT id, data FROM declaration_extracts
          WHERE id = ANY(${textArray(wanted)}::text[])`
      : [],
  ]);
  const extractById = new Map(extracts.map((row) => [row.id, row.data]));
  const people = new Map<string, DeclarationFind>();
  pages.forEach(({ id, data: page }, i) => {
    if (!page || page.type !== "person" || page.deleted === true) return;
    if (people.has(id)) return;
    const extract = extractById.get(extractIds[i]!);
    people.set(id, {
      id,
      name: String(page.name ?? ""),
      published: pageIsPublic(page),
      ...(extract
        ? {
            ...unitOf(extract),
            declarationYear:
              typeof extract.declarationYear === "number"
                ? extract.declarationYear
                : null,
          }
        : { unit: "", office: null, declarationYear: null }),
    });
  });
  return { people: [...people.values()], total: totalCount };
}

/** A crop's pictures as data URLs, or null for a crop that does not exist. */
export async function cropImagesPg(
  extractId: string,
): Promise<{ date: string | null; name: string | null } | null> {
  const [row] = await useDb()<{ exists: boolean; images: Data | null }[]>`
    SELECT true AS exists,
      (SELECT data FROM declaration_extract_images WHERE id = ${extractId}) AS images
    FROM declaration_extracts WHERE id = ${extractId}`;
  if (!row) return null;
  return {
    date: dataUrlOf(row.images?.date),
    name: dataUrlOf(row.images?.name),
  };
}

/** The people snapshot (`readDeclarationPeople`), or null before the first
 * count or for one that does not read. */
export async function readDeclarationPeoplePg(): Promise<DeclarationPeople | null> {
  const [row] = await useDb()<{ data: Data }[]>`
    SELECT data FROM stats WHERE id = ${PEOPLE_DOC}`;
  return row ? parseDeclarationPeople(row.data) : null;
}
