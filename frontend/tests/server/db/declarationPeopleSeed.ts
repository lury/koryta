import type postgres from "postgres";
import type { PersonEntry } from "~~/shared/declarationPeople";
import { PEOPLE_DOC } from "~~/server/utils/declarationPeople";
import {
  entriesOf,
  PEOPLE_META,
  shardData,
} from "~~/server/utils/declarationPeopleCount";
import type { Collections } from "./pgHarness";

/** The people count as the night left it, for the pg tests of what moves a
 * person in it during the day: one entry a page, each still searching,
 * staged before anything the test does. */

export const COUNTED_AT = "2026-11-27T05:15:00.000Z";

export function personEntry(fields: Partial<PersonEntry> = {}): PersonEntry {
  return {
    stage: "searching",
    detail: "not_listed",
    band: 0,
    publishedOn: null,
    unit: "021704",
    unitName: "Strzelin",
    keys: ["k1"],
    candidacies: [
      {
        key: "k1",
        teryt: "021704",
        unitName: "Strzelin",
        year: 2024,
        status: "found",
        reason: "named",
        uncut: false,
        cutNamed: false,
        waiting: false,
      },
    ],
    at: Date.parse(COUNTED_AT),
    ...fields,
  };
}

/** Arranges the night's count of `pages` (and the raw entries of `extra`,
 * which need not read) in `store`. */
export function seedPeople(
  store: Collections,
  pages: readonly string[],
  extra: Record<string, unknown> = {},
) {
  const table = store.table("declarationPeople");
  table[PEOPLE_META] = {
    generation: COUNTED_AT,
    listAt: COUNTED_AT,
    part: "gs://test/facts.jsonl.gz",
    partAt: COUNTED_AT,
    countedAt: COUNTED_AT,
    shards: 8,
  };
  shardData(pages.map((page) => [page, personEntry()] as const)).forEach(
    (data, i) => {
      table[`shard-${i}`] = { entries: { ...data.entries } };
    },
  );
  for (const [page, raw] of Object.entries(extra)) {
    const shard = Object.entries(table).find(([id]) => id.startsWith("shard-"));
    (shard![1].entries as Record<string, unknown>)[page] = raw;
  }
}

/** Every entry the shards hold now, by page. */
export async function peopleEntries(
  sql: postgres.Sql,
): Promise<Record<string, PersonEntry>> {
  const rows = await sql<{ data: Record<string, unknown> }[]>`
    SELECT data FROM declaration_people WHERE id LIKE 'shard-%'`;
  return Object.fromEntries(rows.flatMap((row) => entriesOf(row.data).entries));
}

/** The snapshot the re-staging wrote, or undefined before any. */
export async function peopleSnapshot(
  sql: postgres.Sql,
): Promise<Record<string, unknown> | undefined> {
  const [row] = await sql<{ data: Record<string, unknown> }[]>`
    SELECT data FROM stats WHERE id = ${PEOPLE_DOC}`;
  return row?.data;
}
