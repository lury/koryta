import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { generateChunksLower, searchableText } from "~~/shared/search";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** The search columns of 0101_a_search.sql against `generateChunksLower`,
 * name by name: the chunks the three columns stand for are exactly the
 * chunks the Firestore index held. Over hand-picked names, and over every
 * name in SEARCH_CORPUS_URL (say, a database loaded from the public copy,
 * whose company names carry towns and quotes the seed's do not).
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/searchIndex.pg.test.ts
 */

const corpus = process.env.SEARCH_CORPUS_URL;

type Columns = { whole: string | null; words: string; town: string };

/** The chunks a node's columns answer to, as `chunkMatch` in
 * server/db/search.ts reads them. */
function chunksOf({ whole, words, town }: Columns): Set<string> {
  const chunks = new Set<string>([""]);
  const prefixes = (text: string, mark = "") => {
    for (let i = 1; i <= text.length; i++) chunks.add(mark + text.slice(0, i));
  };
  prefixes(whole ?? "");
  for (const token of words.split(" ")) prefixes(token);
  for (const token of town.split(" ")) prefixes(token, "@");
  return chunks;
}

const TRICKY: [string, string][] = [
  ['STADNINA KONI "KRASNE"', "place"],
  ['HUTA"KOŚCIUSZKO"', "place"],
  ["IM.PROF.STANISŁAWA", "place"],
  ["GERIATRII,REUMATOLOGII", "place"],
  ["...DOMARO", "place"],
  ["Bogusława Kupczak-Wiśniowska", "person"],
  ["Ewa Kukulska - Zając", "person"],
  ["a--b c-", "person"],
  ["-abc def", "person"],
  ["Wodno-Kanalizacyjne Sp. z o.o. (Jelenia Góra)", "place"],
  ["PRZEDSIĘBIORSTWO (Jelenia Góra-Zdrój)  ", "place"],
  ["SANIKOM (Lubawka)", "place"],
  ["ORLEN (Płock)", "place"],
  ["MOPS (OPS)", "place"],
  ["X (W SKRÓCIE: GIWK SP. Z O.O.)", "place"],
  ["X (a (b) c)", "place"],
  ["FIRMA (Kraków) SP. Z O.O.", "place"],
  ["powiat bielski (Bielsko-Biała)", "region"],
  ["Warszawa-Mokotów (Warszawa)", "region"],
  ["(wykreślone)", "place"],
  ["Bartosz Kopania (Pablo Morales)", "person"],
  ["Szpital w Świeciu", "place"],
  ["Zółw Grójec", "person"],
  ["Jan\tKowalski", "person"],
  ["SPÓŁKA\nODPOWIEDZIALNOŚCIĄ", "place"],
  ["Anna Nowak", "person"],
  ["  Anna   Nowak  ", "person"],
  ["Spółka 2000", "place"],
  ["Ośrodek 3²", "place"],
  ["Gimnazjum nr Ⅻ ½ ⁴ ₂ ③ ⓿ ❶", "place"],
  ["١٢٣ ०१", "place"],
  ["Straße Müller", "person"],
  ["Ελλάδα ΑΕ", "place"],
  ["ŻÓŁĆ GĘŚLĄ JAŹŃ", "person"],
  ["!!!", "person"],
  ["", "person"],
  ["Firma 🚀 Nowa", "place"],
  ["O'Connor-Smith", "person"],
];

async function columns(
  sql: postgres.Sql,
  names: [string, string][],
): Promise<Columns[]> {
  return sql<Columns[]>`
    SELECT search_text(c.v ->> 'n') AS whole,
      search_words(c.v ->> 'n', c.v ->> 't') AS words,
      search_town(c.v ->> 'n', c.v ->> 't') AS town
    FROM jsonb_array_elements(${sql.json(
      names.map(([n, t]) => ({ n, t })) as never,
    )}) WITH ORDINALITY AS c(v, i)
    ORDER BY c.i`;
}

function mismatches(names: [string, string][], cols: Columns[]): string[] {
  const out: string[] = [];
  names.forEach(([name, type], i) => {
    const want = new Set(generateChunksLower(name, type));
    const got = chunksOf(cols[i]!);
    const missing = [...want].filter((c) => !got.has(c));
    const extra = [...got].filter((c) => !want.has(c));
    if (
      cols[i]!.whole !== searchableText(name) ||
      missing.length ||
      extra.length
    )
      out.push(
        `${JSON.stringify(name)} (${type}): whole ${JSON.stringify(cols[i]!.whole)}` +
          ` missing ${JSON.stringify(missing.slice(0, 5))} extra ${JSON.stringify(extra.slice(0, 5))}`,
      );
  });
  return out;
}

describe.runIf(PG_TEST_DATABASE_URL)(
  "search columns are generateChunksLower",
  () => {
    let sql: postgres.Sql;
    beforeAll(async () => {
      sql = await openTestDatabase("search_index");
    }, 120_000);
    afterAll(() => closeTestDatabase(sql));

    it("on hand-picked names", async () => {
      expect(mismatches(TRICKY, await columns(sql, TRICKY))).toEqual([]);
    });

    for (const [label, target] of [["the corpus database", corpus]] as const) {
      it.runIf(target)(`on every name in ${label}`, async () => {
        const db = postgres(target!, { max: 1, onnotice: () => {} });
        try {
          const rows = await db<
            {
              name: string;
              type: string;
              whole: string;
              words: string;
              town: string;
            }[]
          >`
          SELECT data ->> 'name' AS name, type, search_whole AS whole,
            search_words AS words, search_town AS town
          FROM nodes WHERE type IN ('person', 'place', 'region')
            AND jsonb_typeof(data -> 'name') = 'string'`;
          const names = rows.map((r) => [r.name, r.type] as [string, string]);
          expect(mismatches(names, rows)).toEqual([]);
          expect(rows.length).toBeGreaterThan(0);
        } finally {
          await db.end();
        }
      });
    }
  },
);
