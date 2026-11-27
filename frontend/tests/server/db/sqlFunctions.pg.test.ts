import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { candidacyElection } from "~~/shared/electionDays";
import { namesASupervisorySeat } from "~~/shared/companyBodies";
import { textArray } from "~~/server/db/textArray";

import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** The SQL copies of shared/ rules in 0002_node_stats.sql, against the
 * TypeScript, case by case.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/sqlFunctions.pg.test.ts
 */
describe.runIf(PG_TEST_DATABASE_URL)("SQL functions agree with shared/", () => {
  let sql: postgres.Sql;
  beforeAll(async () => {
    sql = await openTestDatabase("sql_functions");
  }, 120_000);
  afterAll(() => closeTestDatabase(sql));

  it("election_key is candidacyElection", async () => {
    const cases: [string, string | null, boolean][] = [];
    for (let year = 1985; year <= 2027; year++)
      for (const position of [
        null,
        "",
        "Sejm",
        "Senat",
        "Parlament Europejski",
        "Rada gminy",
        "Wójt",
      ])
        for (const by of [false, true]) {
          cases.push([String(year), position, by]);
          cases.push([`${year}-10-15`, position, by]);
        }
    const rows = await sql<{ k: string | null }[]>`
      SELECT election_key(c.s, c.p, c.b) AS k
      FROM jsonb_to_recordset(${sql.json(
        cases.map(([s, p, b]) => ({ s, p, b })) as never,
      )}) AS c(s text, p text, b boolean)`;
    expect(rows.map((r) => r.k)).toEqual(
      cases.map(([s, p, b]) => candidacyElection(s, p, b)),
    );
  });

  it("js_date reads what new Date reads", async () => {
    const values = [
      "2025",
      "2025-03",
      "2025-03-14",
      "2019-02-31",
      "2025-03-14T10:00:00Z",
      "2025-03-14T10:00:00",
      "2025-03-14T10:00:00+02:00",
      "2008-28-02",
      "2025-13",
      "nonsense",
      "",
    ];
    const rows = await sql<{ ms: number | null }[]>`
      SELECT (extract(epoch FROM js_date(v)) * 1000)::float8 AS ms
      FROM unnest(${textArray(values)}::text[]) WITH ORDINALITY AS u(v, i) ORDER BY i`;
    // Cloud Run's zone, which js_date assumes for a time without one.
    process.env.TZ = "UTC";
    expect(rows.map((r) => r.ms)).toEqual(
      values.map((v) => {
        const ms = new Date(v).getTime();
        return isNaN(ms) ? null : ms;
      }),
    );
  });

  it("names_supervisory_seat is namesASupervisorySeat", async () => {
    const roles = [
      "Członek Rady Nadzorczej",
      "Przewodniczący Rady Społecznej",
      "członek rady społecznej",
      "Prezes Zarządu",
      "Radny",
      "Rada  Nadzorcza",
      "Zastępca Przewodniczącego Rady Nadzorczej",
      "",
    ];
    const rows = await sql<{ seat: boolean }[]>`
      SELECT names_supervisory_seat(r) AS seat
      FROM unnest(${textArray(roles)}::text[]) WITH ORDINALITY AS u(r, i) ORDER BY i`;
    expect(rows.map((r) => r.seat)).toEqual(roles.map(namesASupervisorySeat));
  });
});
