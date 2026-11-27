import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { NODE_OPTIONS_LIMIT, nodeOptions } from "~~/server/db/nodes";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";

/** The options a picker is offered (/api/search/places, /api/search/pages):
 * by name, an article also by link, by id and by KRS number, published ones
 * unless drafts are asked for, never more than NODE_OPTIONS_LIMIT.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/nodeOptions.pg.test.ts
 */

let sql: postgres.Sql;
let stored: StoredDocs = {};

const ids = async (options: Parameters<typeof nodeOptions>[0]) => {
  await syncStored(sql, stored);
  return (await nodeOptions(options)).map((o) => o.id).sort();
};

describe.runIf(PG_TEST_DATABASE_URL)("nodeOptions", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("node_options");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });

  beforeEach(() => {
    stored = {
      "nodes/orlen": {
        type: "place",
        name: "ORLEN S.A.",
        krsNumber: "0000028860",
        published: true,
      },
      "nodes/orlenDraft": { type: "place", name: "Orlen Szkic" },
      "nodes/orlenGone": {
        type: "place",
        name: "Orlen Usunięty",
        published: true,
        deleted: true,
      },
      "nodes/osoba": {
        type: "person",
        name: "Orlen Kowalski",
        published: true,
      },
      "nodes/art": {
        type: "article",
        name: "Zarząd Orlenu odwołany",
        sourceURL: "https://www.example.pl/biznes/pe%C5%82na-lista_zarzadu",
        published: true,
      },
      "nodes/artNameless": {
        type: "article",
        sourceURL: "https://bip.powiat.pruszkow.pl/plik.php?id=275783",
        published: true,
      },
      "nodes/topic": { type: "topic", name: "Orlen i fuzje", published: true },
    };
  });

  it("finds published places of the asked type by part of the name", async () => {
    expect(await ids({ type: "place", q: "orlen", showDrafts: false })).toEqual(
      ["orlen"],
    );
  });

  it("adds drafts for a reader who may see them", async () => {
    expect(await ids({ type: "place", q: "orlen", showDrafts: true })).toEqual([
      "orlen",
      "orlenDraft",
    ]);
  });

  it("names places by id and by KRS number", async () => {
    expect(
      await ids({ type: "place", krs: ["0000028860"], showDrafts: false }),
    ).toEqual(["orlen"]);
    expect(
      await ids({ type: "place", ids: ["orlenDraft"], showDrafts: true }),
    ).toEqual(["orlenDraft"]);
  });

  it("asks nothing of fewer than two letters", async () => {
    expect(await ids({ type: "place", q: "o", showDrafts: true })).toEqual([]);
  });

  it("finds articles by headline and by either spelling of a link", async () => {
    expect(
      await ids({ type: "article", q: "zarząd", showDrafts: false }),
    ).toEqual(["art"]);
    expect(
      await ids({
        type: "article",
        url: [
          "example.pl/biznes/pełna-lista_zarzadu",
          "example.pl/biznes/pe%c5%82na-lista_zarzadu",
        ],
        showDrafts: false,
      }),
    ).toEqual(["art"]);
    // A `_` in the link is a character, not a wildcard.
    expect(
      await ids({ type: "article", url: ["lista-zarzadu"], showDrafts: false }),
    ).toEqual([]);
  });

  it("offers an article without a headline by its link", async () => {
    await syncStored(sql, stored);
    expect(
      await nodeOptions({
        type: "article",
        url: ["plik.php"],
        showDrafts: false,
      }),
    ).toEqual([
      {
        id: "artNameless",
        name: null,
        krsNumber: null,
        url: "https://bip.powiat.pruszkow.pl/plik.php?id=275783",
      },
    ]);
  });

  it("finds topics by name", async () => {
    expect(await ids({ type: "topic", q: "fuzje", showDrafts: false })).toEqual(
      ["topic"],
    );
  });

  it("returns at most NODE_OPTIONS_LIMIT", async () => {
    for (let i = 0; i < NODE_OPTIONS_LIMIT + 5; i++) {
      stored[`nodes/p${i}`] = {
        type: "place",
        name: `Spółka ${i}`,
        published: true,
      };
    }
    expect(
      await ids({ type: "place", q: "spółka", showDrafts: false }),
    ).toHaveLength(NODE_OPTIONS_LIMIT);
  });
});
