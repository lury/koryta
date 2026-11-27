import "./declarationsHarness";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type postgres from "postgres";
import {
  creditFindsPg,
  drainPublicationsPg,
  matchAndDrainPg,
  matchPagesPg,
  readingsOfAnotherDayPg,
  recheckPublicationPg,
  sweepDeclarationsPg,
} from "~~/server/db/declarationPublish";
import {
  afterHandPublicationPg,
  declinePublicationPg,
  decideExtractPg,
  linkedOnAPagePg,
  restorePublicationPg,
} from "~~/server/db/declarationHolds";
import { requeueCropPeoplePg } from "~~/server/db/readingQueue";
import { personDeclarationsPg } from "~~/server/db/declarationPages";
import { STUCK_PUBLISHING_MS } from "~~/server/utils/declarationRules";
import { waitsForAdmin } from "~~/server/utils/declarationDecisions";
import { collectionTables } from "~~/server/db/collections";
import { DECLARATION_ACTOR } from "~~/shared/declarations";
import { approvedRevisionId } from "~~/shared/model";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** What a settled reading does to its pages on Postgres, called on
 * server/db/declarationPublish.ts, declarationHolds.ts and readingQueue.ts
 * themselves: a reader credited with a find, a date an admin settled, a
 * declaration a page lists, the sweep, the readers' queue after a reading,
 * a publication a stale write undid, an admin's „Sprawdź ponownie”, „Nie
 * publikuj” and „Przywróć”, a hold a publication by hand closes or reopens.
 * The cases of tests/server/utils/declarationPublish.test.ts whose Firestore
 * code went in 801aecb1 and 94105148, in the same world: Anna Kowalska, a
 * draft councillor of gmina Strzelin since 2024, whose 2023 declaration
 * readers have read.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationPublication.pg.test.ts
 */

type Data = Record<string, unknown>;

let sql: postgres.Sql;

/** 13:00 in Warsaw: outside the people import's window. */
const NOON = new Date("2026-10-29T12:00:00Z");
/** Ten minutes later, when the next pass comes. */
const LATER = new Date("2026-10-29T12:10:00Z");
const DAY = "2026-10-29";
const BORN = "1979-07-15";
const ADMIN = "admin-uid";
const UNIT = {
  teryt: "021704",
  unitName: "Strzelin (gmina miejsko-wiejska)",
  level: "gmina",
  office: "Rada gminy",
  year: 2024,
};
const LINK = "https://bip.strzelin.pl/download/kowalska-crop";

const TABLE: Record<string, string> = {
  ...collectionTables,
  publications: "declaration_publications",
  extracts: "declaration_extracts",
};

/** `collection/id`, as the Firestore tests named a document. */
function split(path: string): [string, string] {
  const at = path.indexOf("/");
  const name = path.slice(0, at);
  return [TABLE[name] ?? name, path.slice(at + 1)];
}

async function put(path: string, data: Data) {
  const [table, id] = split(path);
  await sql`
    INSERT INTO ${sql(table)} (id, data) VALUES (${id}, ${sql.json(data as never)})
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
}

async function read(path: string): Promise<Data | undefined> {
  const [table, id] = split(path);
  const [row] = await sql<{ data: Data }[]>`
    SELECT data FROM ${sql(table)} WHERE id = ${id}`;
  return row?.data;
}

async function edit(path: string, fields: Data) {
  await put(path, { ...(await read(path))!, ...fields });
}

const record = async (id = "kowalska") =>
  (await read(`declarationPublications/${id}`))!;

/** Every row of every table with when it was written: equal snapshots mean
 * nothing was written in between. */
async function state(): Promise<string> {
  const all: Record<string, unknown> = {};
  for (const table of Object.values(collectionTables)) {
    all[table] = await sql.unsafe(
      `SELECT id, data, updated_at::text AS at FROM ${table} ORDER BY id`,
    );
  }
  return JSON.stringify(all);
}

function revision(nodeId: string, collection: string, data: Data) {
  return {
    node_id: nodeId,
    collection,
    data,
    status: "pending",
    update_user: "pipeline-people-import",
    update_automatic: true,
    update_time: "2026-10-01T02:00:00.000Z",
  };
}

/** A draft written by the people import: the page holds its revision. A
 * field given as undefined is left out (JSON drops it). */
async function person(id: string, page: Data = {}, content: Data = {}) {
  const data: Data = {
    type: "person",
    name: "Anna Kowalska",
    birthDate: BORN,
    ...content,
  };
  await put(`nodes/${id}`, { ...data, published: false, ...page });
  await put(`revisions/rev-${id}`, revision(id, "nodes", data));
}

async function edge(id: string, data: Data) {
  await put(`edges/${id}`, { ...data, published: false });
  await put(`revisions/rev-${id}`, revision(id, "edges", data));
}

const candidacy = (id: string, source: string) =>
  edge(id, {
    type: "election",
    name: "kandydatura",
    source,
    target: "teryt0217",
    position: "Rada gminy",
    start_date: "2024-01-01",
    elected: true,
  });

const job = (id: string, source: string, company: string) =>
  edge(id, {
    type: "employed",
    name: "Rada Nadzorcza",
    source,
    target: company,
    start_date: "2020-03-01",
  });

const extract = (id: string, fields: Data = {}) =>
  put(`declarationExtracts/${id}`, {
    status: "agreed",
    agreed: { value: BORN, kind: "date", by: "readers", readers: 2 },
    agreedName: null,
    personIds: ["kowalska"],
    units: [UNIT],
    url: `https://bip.strzelin.pl/download/${id}`,
    declarationYear: 2023,
    page: 1,
    pageMatch: null,
    ...fields,
  });

/** Her page, her 2024 run in Strzelin, a job at a public company, and her
 * crop - settled, not yet compared. */
async function kowalska(id = "kowalska") {
  await person(id);
  await candidacy(`${id}-run`, id);
  await job(`${id}-job`, id, "wodociagi");
  await extract(`${id}-crop`, { personIds: [id] });
}

/** The same, queued for publication. */
async function queued(id = "kowalska") {
  await kowalska(id);
  await matchPagesPg(`${id}-crop`, NOON);
  expect(await record(id)).toMatchObject({ status: "queued" });
}

/** The handlers' clock reads what a call's `now` says. */
function at<T>(now: Date, call: () => Promise<T>): Promise<T> {
  vi.setSystemTime(now);
  return call();
}

const drain = (limit = 3, now = NOON) =>
  at(now, () => drainPublicationsPg(now, limit));
const press = (limit = 0, now = NOON) =>
  at(now, () => drainPublicationsPg(now, limit, { pressedBy: ADMIN }));
const sweep = (now: Date, limit: number) =>
  at(now, () => sweepDeclarationsPg(now, limit));
const recheck = (id = "kowalska", now = NOON) =>
  at(now, () => recheckPublicationPg(id, ADMIN, now));
const decide = (
  extractId: string,
  decision: Parameters<typeof decideExtractPg>[0]["decision"],
  now = NOON,
) => decideExtractPg({ extractId, uid: ADMIN, decision, now });
const closeHold = (id: string, now: Date) =>
  at(now, () => afterHandPublicationPg(id, ADMIN, true));
const reopenHold = (id: string, now: Date) =>
  at(now, () => afterHandPublicationPg(id, ADMIN, false));

/** A people import running now, as ops.job_runs has it. */
async function importRunning() {
  await sql`
    INSERT INTO ops.job_runs (id, data) VALUES ('run-1', ${sql.json({
      job: "people_import",
      state: "running",
      startedAt: NOON.toISOString(),
      heartbeatAt: NOON.toISOString(),
    })})`;
}

/** Every publication of her page in the audit log, in the order filed. */
async function pagePublications(id = "kowalska") {
  const rows = await sql<{ data: Data }[]>`
    SELECT data FROM audit
    WHERE data @> ${sql.json({ action: "publish", collection: "nodes", target_id: id })}
    ORDER BY data ->> 'at', created_at, id`;
  return rows.map(({ data }) => ({
    user: data.user,
    pressedBy: data.pressed_by,
  }));
}

/** The declarations her public page lists (/api/nodes/<id>/declarations). */
async function shown(id = "kowalska") {
  return (await personDeclarationsPg(id))?.declarations ?? [];
}

/** Makes every write to `table` fail while it is on, as an unavailable
 * database does. */
const breaking = (table: string) =>
  sql`INSERT INTO test_broken VALUES (${table})`;
const mend = () => sql`DELETE FROM test_broken`;

async function failure(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    return error as { statusCode?: number; message: string };
  }
  throw new Error("expected the call to throw");
}

describe.runIf(PG_TEST_DATABASE_URL)("declarations, a settled reading", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("declb_publication");
    await sql.unsafe(`
      CREATE TABLE test_broken (name text PRIMARY KEY);
      CREATE FUNCTION test_break() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM test_broken WHERE name = TG_TABLE_NAME) THEN
          RAISE EXCEPTION 'unavailable';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_break BEFORE UPDATE ON nodes
        FOR EACH ROW EXECUTE FUNCTION test_break();
      CREATE TRIGGER test_break BEFORE UPDATE ON edges
        FOR EACH ROW EXECUTE FUNCTION test_break();`);
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOON);
    vi.spyOn(console, "info").mockImplementation(() => {});
    await sql.unsafe(
      `TRUNCATE ${Object.values(collectionTables).join(", ")}, ops.job_runs, test_broken`,
    );
    for (const [id, name] of [
      ["teryt0217", "powiat strzeliński"],
      ["teryt0401", "powiat aleksandrowski"],
      ["teryt1465", "Warszawa"],
    ]) {
      await put(`nodes/${id}`, { type: "region", name, published: true });
    }
    // The gmina's own water company: a seat on its board is the paid public
    // post every page the automation publishes has to have.
    await put("nodes/wodociagi", {
      type: "place",
      name: "Wodociągi Strzelin",
      published: true,
      isPublic: true,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("creditFinds", () => {
    const typed = (uid: string, value: string, personIds = ["kowalska"]) =>
      creditFindsPg(
        { uid, extractId: "kowalska-crop", personIds, value },
        NOON,
      );
    const finds = async () =>
      (
        await sql<
          { id: string }[]
        >`SELECT id FROM declaration_reader_finds ORDER BY id`
      ).map((row) => row.id);

    it("credits a date the page was born on, or its year, and not another one", async () => {
      await kowalska();
      expect(await typed("a", BORN)).toBe(1);
      expect(await typed("b", "1979")).toBe(1);
      expect(await typed("c", "1979-07-16")).toBe(0);
      expect(await typed("d", "1980")).toBe(0);
      expect(await finds()).toEqual(["a_kowalska", "b_kowalska"]);
      expect(await read("declarationReaderFinds/a_kowalska")).toMatchObject({
        uid: "a",
        personId: "kowalska",
        extractId: "kowalska-crop",
      });
    });

    it("credits any date for a page without a birth date, which has nothing to contradict", async () => {
      await person("kowalska", {}, { birthDate: undefined });
      expect(await typed("a", "1984-02-29")).toBe(1);
      expect(await typed("anon:x", "1961")).toBe(1);
      expect(await finds()).toEqual(["a_kowalska", "anon:x_kowalska"]);
    });

    it("credits a published person the same as a draft", async () => {
      await person("kowalska", { published: true });
      expect(await typed("a", BORN)).toBe(1);
    });

    it("keeps one record a reader and a person", async () => {
      await kowalska();
      await typed("a", BORN);
      await typed("a", "1979");
      expect(await finds()).toEqual(["a_kowalska"]);
    });

    it("credits the page a merged one went into", async () => {
      await kowalska();
      await put("nodes/old", {
        type: "person",
        deleted: true,
        merged_into: "kowalska",
      });
      expect(await typed("a", BORN, ["old"])).toBe(1);
      expect(await finds()).toEqual(["a_kowalska"]);
    });

    it("credits each of a crop's people the date does not contradict, and no page that is gone", async () => {
      await kowalska();
      await person("namesake", {}, { birthDate: "1981-01-01" });
      await person("undated", {}, { birthDate: undefined });
      await put("nodes/gone", { type: "person", deleted: true });
      expect(
        await typed("a", BORN, ["kowalska", "namesake", "undated", "gone"]),
      ).toBe(2);
      expect(await finds()).toEqual(["a_kowalska", "a_undated"]);
    });

    it("is not what comparing a settled crop does: readers were credited as they answered", async () => {
      await kowalska();
      await put("declarationAnswers/kowalska-crop_a", {
        extractId: "kowalska-crop",
        uid: "a",
        verdict: "date",
        value: BORN,
        votes: true,
      });
      await matchPagesPg("kowalska-crop", NOON);
      expect(await finds()).toEqual([]);
    });
  });

  // The admin chose the date with the pages' dates a click away, so it
  // confirms nothing: until decided otherwise, it holds the page.
  describe("a date an admin settled", () => {
    async function settledByAdmin(id: string) {
      await extract(id, { status: "disputed", agreed: null });
      await decide(id, { verdict: "date", value: BORN });
    }

    it("holds a draft born that day for somebody to publish by hand", async () => {
      await kowalska();
      await settledByAdmin("kowalska-crop");
      const { matched, drain: pass } = await at(NOON, () =>
        matchAndDrainPg(["kowalska-crop"], NOON, 3),
      );
      expect(matched).toMatchObject([
        { pageMatch: "same", outcomes: { kowalska: "held" } },
      ]);
      expect(await record()).toMatchObject({
        status: "held",
        reason: "admin_decision",
        extractIds: ["kowalska-crop"],
        queuedAt: NOON.toISOString(),
        heldAt: NOON.toISOString(),
      });
      expect(pass.published).toEqual([]);
      expect((await read("nodes/kowalska"))!.published).toBe(false);
    });

    it("never confirms a page that is public already, nor holds it", async () => {
      await kowalska();
      await edit("nodes/kowalska", { published: true });
      await settledByAdmin("kowalska-crop");
      const result = await matchPagesPg("kowalska-crop", NOON);
      expect(result.outcomes).toEqual({ kowalska: "held" });
      expect(await read("declarationExtracts/kowalska-crop")).toMatchObject({
        pageMatch: "same",
        pageOutcomes: { kowalska: "held" },
        pageRecheck: false,
      });
      expect(await read("declarationPublications/kowalska")).toBeUndefined();
      const before = await state();
      await matchPagesPg("kowalska-crop", LATER);
      expect(await state()).toBe(before);
    });

    it("still holds a draft that a public page shares the date with", async () => {
      await kowalska();
      await edit("nodes/kowalska", { published: true });
      await person("kowalska-2");
      await settledByAdmin("kowalska-crop");
      await edit("declarationExtracts/kowalska-crop", {
        personIds: ["kowalska", "kowalska-2"],
      });
      const result = await matchPagesPg("kowalska-crop", NOON);
      expect(result.outcomes).toEqual({
        kowalska: "held",
        "kowalska-2": "held",
      });
      expect(await read("declarationPublications/kowalska")).toBeUndefined();
      expect(await record("kowalska-2")).toMatchObject({
        status: "held",
        reason: "admin_decision",
      });
    });

    it("joins no record that readers made, and the pass publishes her on theirs alone", async () => {
      await queued();
      const before = await record();
      await settledByAdmin("kowalska-2022");
      const result = await matchPagesPg("kowalska-2022", NOON);
      expect(result.outcomes).toEqual({ kowalska: "held" });
      expect(await record()).toEqual(before);
      expect((await drain()).published).toEqual(["kowalska"]);
      expect(await record()).toMatchObject({
        extractIds: ["kowalska-crop"],
        declarations: [{ url: LINK }],
      });
    });

    it("gives way to readers who match the page later, without the admin's crop", async () => {
      await kowalska();
      await settledByAdmin("kowalska-crop");
      await matchPagesPg("kowalska-crop", NOON);
      await extract("kowalska-2024", { declarationYear: 2024 });
      const result = await matchPagesPg("kowalska-2024", LATER);
      expect(result.outcomes).toEqual({ kowalska: "queued" });
      const stored = await record();
      expect(stored).toMatchObject({
        status: "queued",
        reason: null,
        extractIds: ["kowalska-2024"],
        declarations: [
          { url: "https://bip.strzelin.pl/download/kowalska-2024", year: 2024 },
        ],
        // In line from when readers matched her, not from the admin's hold.
        queuedAt: LATER.toISOString(),
      });
      expect((stored.declarations as unknown[]).length).toBe(1);
      expect((await drain(3, LATER)).published).toEqual(["kowalska"]);
    });

    it("publishes nobody on a crop an admin corrected to the page's new date", async () => {
      await queued();
      const moved = {
        type: "person",
        name: "Anna Kowalska",
        birthDate: "1980-01-02",
      };
      await put("nodes/kowalska", { ...moved, published: false });
      await put("revisions/rev-kowalska-2", {
        ...revision("kowalska", "nodes", moved),
        update_time: "2026-10-20T02:00:00.000Z",
      });
      await matchPagesPg("kowalska-crop", NOON);
      await decide("kowalska-crop", { verdict: "date", value: "1980-01-02" });
      await matchPagesPg("kowalska-crop", NOON);
      const pass = await drain();
      expect(pass.published).toEqual([]);
      expect(pass.held).toEqual([
        { personId: "kowalska", reason: "no_longer_matches" },
      ]);
      expect((await read("nodes/kowalska"))!.published).toBe(false);
    });

    it("flags a page born on another day as any reading does", async () => {
      await kowalska();
      await edit("nodes/kowalska", { birthDate: "1980-01-02" });
      await settledByAdmin("kowalska-crop");
      const result = await matchPagesPg("kowalska-crop", NOON);
      expect(result.pageMatch).toBe("different");
      const note = (await read(`notes/kowalska_${DECLARATION_ACTOR}`))!;
      expect(note.sources).toMatchObject([
        { declarationExtractId: "kowalska-crop" },
      ]);
      expect(await read("declarationPublications/kowalska")).toBeUndefined();
      // Back on the overview's „Inna data niż na stronie” for an admin.
      expect(
        waitsForAdmin(await read("declarationExtracts/kowalska-crop")),
      ).toBe(true);
    });
  });

  // What /api/nodes/<id>/declarations lists on a public page.
  describe("confirmedDeclarations", () => {
    async function confirmedWithNamesake() {
      await kowalska();
      await edit("nodes/kowalska", { published: true });
      await put("nodes/namesake", {
        type: "person",
        name: "Anna Kowalska",
        published: false,
      });
      await extract("kowalska-crop", { personIds: ["kowalska", "namesake"] });
      await matchPagesPg("kowalska-crop", NOON);
      expect(await record()).toMatchObject({
        status: "confirmed",
        extractIds: ["kowalska-crop"],
      });
    }

    async function dateCorrected() {
      await edit("nodes/kowalska", { birthDate: "1980-01-02" });
      await matchPagesPg("kowalska-crop", LATER);
      expect(
        waitsForAdmin(await read("declarationExtracts/kowalska-crop")),
      ).toBe(true);
    }

    it("lists nothing for a crop an admin withdrew, though the record still names it", async () => {
      await confirmedWithNamesake();
      await dateCorrected();
      // The correction is undone before the admin takes the crop back, so
      // only the withdrawal can keep the crop off.
      await edit("nodes/kowalska", { birthDate: BORN });
      await decide("kowalska-crop", { verdict: "withdraw" }, LATER);
      expect(await record()).toMatchObject({
        status: "confirmed",
        extractIds: ["kowalska-crop"],
      });
      expect(await shown()).toEqual([]);
      // So the endpoints drop the page's cached answer after the decision.
      expect(await linkedOnAPagePg("kowalska-crop")).toBe(true);
    });

    it("lists a crop an admin settled again on the page's new date", async () => {
      await confirmedWithNamesake();
      await dateCorrected();
      await decide(
        "kowalska-crop",
        { verdict: "date", value: "1980-01-02" },
        LATER,
      );
      await matchPagesPg("kowalska-crop", LATER);
      // The crop and the page agree now, on the admin's date: the page shows
      // the declaration (decision on 2026-11-18), the record left as it was.
      expect(await read("declarationExtracts/kowalska-crop")).toMatchObject({
        agreed: { value: "1980-01-02", by: "admin" },
        pageMatch: "same",
      });
      expect(await record()).toMatchObject({ status: "confirmed" });
      expect(await shown()).toMatchObject([{ url: LINK }]);
    });
  });

  describe("linkedOnAPage", () => {
    it("is whether a published or confirmed record lists the crop", async () => {
      await put("declarationPublications/up", {
        status: "published",
        extractIds: ["a", "b"],
      });
      await put("declarationPublications/linked", {
        status: "confirmed",
        extractIds: ["c"],
      });
      await put("declarationPublications/waiting", {
        status: "queued",
        extractIds: ["d"],
      });
      await put("declarationPublications/held", {
        status: "held",
        reason: "admin_decision",
        extractIds: ["e"],
      });
      expect(await linkedOnAPagePg("b")).toBe(true);
      expect(await linkedOnAPagePg("c")).toBe(true);
      for (const id of ["d", "e", "nowhere"]) {
        expect(await linkedOnAPagePg(id), id).toBe(false);
      }
    });

    it("says yes when it cannot tell", async () => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      await sql`ALTER TABLE declaration_publications RENAME TO declaration_publications_away`;
      try {
        expect(await linkedOnAPagePg("a")).toBe(true);
      } finally {
        await sql`ALTER TABLE declaration_publications_away RENAME TO declaration_publications`;
      }
      expect(quiet).toHaveBeenCalled();
    });
  });

  describe("her jobs, by where her birth date came from", () => {
    it("holds them where a person typed it", async () => {
      await queued();
      const link = "https://rejestr.io/osoby/123";
      await edit("nodes/kowalska", { rejestrIo: link });
      const own = (await read("revisions/rev-kowalska"))!;
      await put("revisions/rev-kowalska", {
        ...own,
        data: { ...(own.data as Data), rejestrIo: link },
      });
      // An older revision that carried the date first, a person's.
      await put("revisions/first", {
        ...revision("kowalska", "nodes", {
          type: "person",
          name: "Anna Kowalska",
          birthDate: BORN,
          rejestrIo: link,
        }),
        status: "approved",
        update_time: "2026-09-01T02:00:00.000Z",
        update_user: "editor-uid",
        update_automatic: false,
        review_user: "admin-uid",
      });

      const result = await drain();

      // The page and the candidacy the declaration is about go up.
      expect(result.published).toEqual(["kowalska"]);
      expect((await read("edges/kowalska-run"))!.published).toBe(true);
      expect((await read("edges/kowalska-job"))!.published).toBe(false);
      expect(await record()).toMatchObject({
        edges: {
          published: ["kowalska-run"],
          held: [{ id: "kowalska-job", reason: "date_not_from_entry" }],
        },
      });
    });
  });

  describe("sweepDeclarations", () => {
    it("compares the settled crops nothing has compared, and publishes", async () => {
      await kowalska();
      const result = await sweep(NOON, 1);
      expect(result).toMatchObject({ checked: 1, changed: 1 });
      expect(result.drain.published).toEqual(["kowalska"]);
    });

    it("compares again a crop whose page has a birth date since", async () => {
      await kowalska();
      await edit("nodes/kowalska", { birthDate: "" });
      await matchPagesPg("kowalska-crop", NOON);
      // The nightly import brings the date.
      await edit("nodes/kowalska", { birthDate: BORN });
      const result = await sweep(new Date("2026-10-30T12:00:00Z"), 0);
      expect(result.changed).toBe(1);
      expect((await read("declarationExtracts/kowalska-crop"))!.pageMatch).toBe(
        "same",
      );
      expect((await record()).status).toBe("queued");
    });

    it("holds both pages once the second one the crop names gains the date", async () => {
      await kowalska();
      await person("kowalska-2", {}, { birthDate: "" });
      await edit("declarationExtracts/kowalska-crop", {
        personIds: ["kowalska", "kowalska-2"],
      });
      await matchPagesPg("kowalska-crop", NOON);
      expect(await read("declarationExtracts/kowalska-crop")).toMatchObject({
        pageMatch: "same",
        pageRecheck: true,
      });
      await edit("nodes/kowalska-2", { birthDate: BORN });
      const result = await sweep(LATER, 3);
      expect(result).toMatchObject({ checked: 1, changed: 1 });
      expect(result.drain.published).toEqual([]);
      // For the people count to move.
      expect(result.touched).toEqual(["kowalska", "kowalska-2"]);
      for (const id of ["kowalska", "kowalska-2"]) {
        expect(await record(id)).toMatchObject({
          status: "held",
          reason: "two_pages",
        });
      }
      expect(
        (await read("declarationExtracts/kowalska-crop"))!.pageRecheck,
      ).toBe(false);
    });

    it("queues a page once its other birth date is corrected to the reading", async () => {
      await kowalska();
      await edit("nodes/kowalska", { birthDate: "1980-01-02" });
      await matchPagesPg("kowalska-crop", NOON);
      expect(await read("declarationExtracts/kowalska-crop")).toMatchObject({
        pageMatch: "different",
        pageRecheck: true,
      });
      await edit("nodes/kowalska", { birthDate: BORN });
      const result = await sweep(LATER, 0);
      expect(result.changed).toBe(1);
      expect((await record()).status).toBe("queued");
    });

    it("sends a crop still without a date to the back of the line", async () => {
      await kowalska();
      await edit("nodes/kowalska", { birthDate: "" });
      await matchPagesPg("kowalska-crop", NOON);
      const later = new Date("2026-10-30T12:00:00Z");
      const result = await sweep(later, 0);
      expect(result).toMatchObject({ checked: 1, changed: 0 });
      expect(
        (await read("declarationExtracts/kowalska-crop"))!.pageCheckedAt,
      ).toBe(later.toISOString());
    });
  });

  describe("the readers' queue after a reading", () => {
    const open = (id: string, fields: Data = {}) =>
      put(`declarationExtracts/${id}`, {
        status: "open",
        priority: 0,
        answerCount: 0,
        rand: 0.5,
        personIds: ["kowalska"],
        units: [UNIT],
        ...fields,
      });
    const priorityOf = async (id: string) =>
      (await read(`declarationExtracts/${id}`))?.priority;

    it("moves them when the sweep compares the reading", async () => {
      await kowalska();
      await open("hers-2022");
      await sweep(NOON, 0);
      expect(await priorityOf("hers-2022")).toBe(4);
    });

    it("brings them back when an admin takes her only reading back", async () => {
      await kowalska();
      await extract("kowalska-crop", {
        agreed: {
          value: "1980-01-01",
          kind: "date",
          by: "readers",
          readers: 2,
        },
      });
      await open("hers-2022");
      await open("hers-2021", { machine: { birthDate: "1981-02-03" } });
      await at(NOON, () => matchAndDrainPg(["kowalska-crop"], NOON, 0));
      expect(await priorityOf("hers-2022")).toBe(4);

      await decide("kowalska-crop", { verdict: "withdraw" }, LATER);
      await requeueCropPeoplePg("kowalska-crop");

      // A dated draft with a paid post; the job read another day off the
      // other crop, so it goes half a tier back.
      expect(await priorityOf("hers-2022")).toBe(0);
      expect(await priorityOf("hers-2021")).toBe(0.5);
    });
  });

  describe("a publication a stale write undid", () => {
    /** Published by a pass, or at an admin's press, then written back whole
     * by an import request that had read the page before it. */
    async function reverted(pressed = false) {
      await queued();
      await (pressed ? press() : drain());
      expect((await read("nodes/kowalska"))!.published).toBe(true);
      const data = {
        type: "person",
        name: "Anna Kowalska",
        birthDate: BORN,
        wikipedia: "https://pl.wikipedia.org/wiki/Anna_Kowalska",
      };
      await put("revisions/rev-kowalska-2", {
        ...revision("kowalska", "nodes", data),
        update_time: "2026-10-29T12:00:05.000Z",
      });
      await put("nodes/kowalska", { ...data, published: false });
    }

    it("puts the page back up, under the slot it went up under", async () => {
      await reverted();
      const result = await sweep(LATER, 3);
      expect(result.reverted).toEqual({ restored: ["kowalska"], held: [] });
      expect(result.touched).toEqual(["kowalska"]);
      const page = (await read("nodes/kowalska"))!;
      expect(page.published).toBe(true);
      // The import's revision, approved on the way back up, then „Inne” over
      // it again: the stale write took that off with the rest.
      expect((await read("revisions/rev-kowalska-2"))!.status).toBe("approved");
      expect(page.parties).toEqual(["Inne"]);
      expect(
        await read(`revisions/${approvedRevisionId(page.revision_id)}`),
      ).toMatchObject({
        data: {
          wikipedia: "https://pl.wikipedia.org/wiki/Anna_Kowalska",
          parties: ["Inne"],
        },
        status: "approved",
      });
      expect((await read("edges/kowalska-run"))!.published).toBe(true);
      expect(await record()).toMatchObject({
        status: "published",
        revertedAt: LATER.toISOString(),
        edges: { published: ["kowalska-run", "kowalska-job"] },
      });
      expect(await read(`declarationPublishLimits/${DAY}`)).toMatchObject({
        count: 1,
      });
    });

    it("puts a page an admin pressed for back as its own repair, so the press counts once", async () => {
      await reverted(true);
      const result = await sweep(LATER, 3);
      expect(result.reverted).toEqual({ restored: ["kowalska"], held: [] });
      expect(await pagePublications()).toEqual([
        { user: DECLARATION_ACTOR, pressedBy: ADMIN },
        { user: DECLARATION_ACTOR, pressedBy: undefined },
      ]);
    });

    it("takes the relations down with a page it may not put back", async () => {
      await reverted();
      // A reader's request to take her page down, waiting for a reviewer.
      await put("revisions/removal-by-reader", {
        ...revision("kowalska", "nodes", {
          type: "person",
          name: "Anna Kowalska",
          birthDate: BORN,
          deleted: true,
          delete_reason: "osoba prywatna",
        }),
        update_user: "reader-uid",
        update_automatic: false,
        update_time: "2026-10-20T10:00:00.000Z",
      });
      const result = await sweep(LATER, 3);
      expect(result.reverted).toEqual({
        restored: [],
        held: [{ personId: "kowalska", reason: "pending_proposal" }],
      });
      expect((await read("nodes/kowalska"))!.published).toBe(false);
      expect((await read("edges/kowalska-run"))!.published).toBe(false);
      expect((await read("edges/kowalska-job"))!.published).toBe(false);
      expect(await record()).toMatchObject({
        status: "held",
        reason: "pending_proposal",
        revertedAt: LATER.toISOString(),
      });
    });

    it("waits while a people import is running", async () => {
      await reverted();
      await importRunning();
      const result = await sweep(LATER, 3);
      expect(result.reverted).toEqual({ restored: [], held: [] });
      expect((await read("nodes/kowalska"))!.published).toBe(false);
    });

    it("leaves a page somebody took down", async () => {
      await queued();
      await drain();
      await edit("nodes/kowalska", { published: false });
      await put("audit/by-admin", {
        action: "unpublish",
        collection: "nodes",
        target_id: "kowalska",
        user: ADMIN,
        at: "2099-01-01T00:00:00.000Z",
      });
      const before = await state();
      const result = await sweep(LATER, 3);
      expect(result.reverted).toEqual({ restored: [], held: [] });
      expect(await state()).toBe(before);
    });
  });

  describe("what an admin does about a held page", () => {
    /** Her page, held because nobody is paid for a public post on it. */
    async function heldForNoPost() {
      await queued();
      await edit("nodes/wodociagi", { isPublic: false });
      await drain();
      expect(await record()).toMatchObject({
        status: "held",
        reason: "no_public_post",
      });
    }

    /** Her page, held because another of her declarations reads another day. */
    async function heldForAnotherReading() {
      await queued();
      await extract("kowalska-crop-2", {
        agreed: { value: "1981-02-03", kind: "date", by: "readers" },
        declarationYear: 2022,
      });
      await matchPagesPg("kowalska-crop-2", NOON);
      await drain();
      expect(await record()).toMatchObject({
        status: "held",
        reason: "conflicting_reading",
      });
    }

    /** Her draft, held on a date an admin settled. */
    async function heldOnAnAdminsDate() {
      await kowalska();
      await edit("declarationExtracts/kowalska-crop", {
        agreed: { value: BORN, kind: "date", by: "admin" },
      });
      await matchPagesPg("kowalska-crop", NOON);
      expect(await record()).toMatchObject({
        status: "held",
        reason: "admin_decision",
      });
    }

    describe("recheckPublication", () => {
      it("publishes a page once what held it is gone, in the admin's name and in no place of the day", async () => {
        await heldForNoPost();
        // Somebody established the owner.
        await edit("nodes/wodociagi", { isPublic: true });
        await expect(recheck()).resolves.toEqual({ outcome: "published" });
        expect((await read("nodes/kowalska"))!.published).toBe(true);
        expect((await read("edges/kowalska-run"))!.published).toBe(true);
        expect((await read("edges/kowalska-job"))!.published).toBe(true);
        expect(await record()).toMatchObject({
          status: "published",
          reason: null,
          pressedBy: ADMIN,
          autoPublished: false,
        });
        expect((await record()).day).toBeUndefined();
        expect(await read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 0,
        });
        expect(await pagePublications()).toEqual([
          { user: DECLARATION_ACTOR, pressedBy: ADMIN },
        ]);
      });

      it("publishes past a limit of 0: asking is an admin's decision, like a press", async () => {
        await heldForNoPost();
        await edit("nodes/wodociagi", { isPublic: true });
        await put(`declarationPublishLimits/${DAY}`, { day: DAY, count: 99 });
        await expect(recheck()).resolves.toEqual({ outcome: "published" });
        expect(await read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 99,
        });
      });

      it("holds the page again, for what stops it now", async () => {
        await heldForNoPost();
        await edit("nodes/kowalska", {
          needs_split: { reason: "dwie osoby", at: "", user: "admin" },
        });
        await expect(recheck()).resolves.toEqual({
          outcome: "held",
          reason: "needs_split",
        });
        expect((await read("nodes/kowalska"))!.published).toBe(false);
        expect(await record()).toMatchObject({
          status: "held",
          reason: "needs_split",
        });
      });

      it("says so when nothing has changed", async () => {
        await heldForNoPost();
        const reason = "no_public_post";
        await expect(recheck()).resolves.toEqual({ outcome: "held", reason });
        expect(await record()).toMatchObject({ status: "held", reason });
        expect((await read("edges/kowalska-run"))!.published).toBe(false);
      });

      it("lets a page up once the crop that read another day is withdrawn", async () => {
        await heldForAnotherReading();
        await decide("kowalska-crop-2", { verdict: "withdraw" });
        await expect(recheck()).resolves.toEqual({ outcome: "published" });
        expect((await read("nodes/kowalska"))!.published).toBe(true);
      });

      it("asks two pages again rather than take the record's word for it", async () => {
        await kowalska();
        await person("kowalska-2");
        await edit("declarationExtracts/kowalska-crop", {
          personIds: ["kowalska", "kowalska-2"],
        });
        await matchPagesPg("kowalska-crop", NOON);
        expect(await record()).toMatchObject({ reason: "two_pages" });
        await expect(recheck()).resolves.toEqual({
          outcome: "held",
          reason: "two_pages",
        });
        // Merged into her page, nothing carried over.
        await edit("nodes/kowalska-2", { merged_into: "kowalska" });
        await expect(recheck()).resolves.toEqual({ outcome: "published" });
      });

      it("does not close a public page's two-pages hold while the other page has its date", async () => {
        await kowalska();
        await edit("nodes/kowalska", { published: true });
        await person("kowalska-2");
        await edit("declarationExtracts/kowalska-crop", {
          personIds: ["kowalska", "kowalska-2"],
        });
        await matchPagesPg("kowalska-crop", NOON);
        expect(await record()).toMatchObject({
          status: "held",
          reason: "two_pages",
        });
        await expect(recheck()).resolves.toEqual({
          outcome: "held",
          reason: "two_pages",
        });
        expect(await record()).toMatchObject({
          status: "held",
          reason: "two_pages",
        });
        await edit("nodes/kowalska-2", { merged_into: "kowalska" });
        await expect(recheck()).resolves.toEqual({ outcome: "confirmed" });
      });

      it("refuses a draft only an admin's date holds: that is published by hand", async () => {
        await heldOnAnAdminsDate();
        const before = await state();
        expect((await failure(recheck())).statusCode).toBe(409);
        expect(await state()).toBe(before);
      });

      it("closes the hold of a page that is public by now, an admin's date too", async () => {
        await heldOnAnAdminsDate();
        await edit("nodes/kowalska", { published: true });
        await expect(recheck()).resolves.toEqual({ outcome: "confirmed" });
        expect(await record()).toMatchObject({
          status: "confirmed",
          reason: null,
        });
      });

      it("refuses a page that is not held, and one with no record", async () => {
        await queued();
        const before = await state();
        expect((await failure(recheck())).statusCode).toBe(409);
        expect((await failure(recheck("nobody"))).statusCode).toBe(404);
        expect(await state()).toBe(before);
      });

      it("refuses a page an admin declined: that is put back first", async () => {
        await heldForNoPost();
        await declinePublicationPg("kowalska", ADMIN, NOON);
        expect((await failure(recheck())).statusCode).toBe(409);
      });

      it("touches nothing inside the people import's night window", async () => {
        await heldForNoPost();
        await edit("nodes/wodociagi", { isPublic: true });
        const before = await state();
        await expect(
          recheck("kowalska", new Date("2026-10-29T02:00:00Z")),
        ).resolves.toEqual({ outcome: "skipped", skipped: "night" });
        expect(await state()).toBe(before);
      });

      it("touches nothing while a people import runs", async () => {
        await heldForNoPost();
        await edit("nodes/wodociagi", { isPublic: true });
        await importRunning();
        const before = await state();
        await expect(recheck()).resolves.toEqual({
          outcome: "skipped",
          skipped: "import",
        });
        expect(await state()).toBe(before);
      });

      it("leaves the claim for the next pass when it fails after the page went up", async () => {
        await heldForNoPost();
        await edit("nodes/wodociagi", { isPublic: true });
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        // The page's own commit goes through; the relations' fail.
        await breaking("edges");
        await expect(recheck()).rejects.toThrow("unavailable");
        await mend();
        expect((await read("nodes/kowalska"))!.published).toBe(true);
        // Not a hold on a public page: the next pass finishes it, as a press.
        expect(await record()).toMatchObject({
          status: "publishing",
          pressedBy: ADMIN,
        });
        const later = new Date(NOON.getTime() + STUCK_PUBLISHING_MS + 60_000);
        expect((await press(0, later)).published).toEqual(["kowalska"]);
        quiet.mockRestore();
      });

      it("puts the hold back as it was when the pass fails half way", async () => {
        await heldForNoPost();
        await edit("nodes/wodociagi", { isPublic: true });
        await breaking("nodes");
        await expect(recheck()).rejects.toThrow("unavailable");
        await mend();
        // Not left `publishing` with no reason, out of every admin list.
        expect(await record()).toMatchObject({
          status: "held",
          reason: "no_public_post",
        });
        await expect(recheck()).resolves.toEqual({ outcome: "published" });
      });
    });

    describe("declinePublication and restorePublication", () => {
      it("sets the page aside with the reason it was held for, and nothing else", async () => {
        await heldForAnotherReading();
        const page = JSON.stringify(await read("nodes/kowalska"));
        await declinePublicationPg("kowalska", ADMIN, NOON);
        expect(await record()).toMatchObject({
          status: "held",
          reason: "conflicting_reading",
          declinedBy: ADMIN,
          declinedAt: NOON.toISOString(),
        });
        expect(JSON.stringify(await read("nodes/kowalska"))).toBe(page);
      });

      it("is taken up by nothing: not a later reading, not a press, not a sweep", async () => {
        await heldForNoPost();
        await edit("nodes/wodociagi", { isPublic: true });
        await declinePublicationPg("kowalska", ADMIN, NOON);
        await extract("kowalska-crop-2", { declarationYear: 2022 });
        await matchPagesPg("kowalska-crop-2", LATER);
        await sweep(LATER, 3);
        await press(0, LATER);
        expect(await record()).toMatchObject({
          status: "held",
          reason: "no_public_post",
          declinedBy: ADMIN,
          extractIds: ["kowalska-crop", "kowalska-crop-2"],
        });
        expect((await read("nodes/kowalska"))!.published).toBe(false);
      });

      it("stays declined when a second page or an admin's date would hold it", async () => {
        await heldForNoPost();
        await declinePublicationPg("kowalska", ADMIN, NOON);
        await person("kowalska-2");
        await extract("kowalska-crop-2", {
          personIds: ["kowalska", "kowalska-2"],
          declarationYear: 2022,
        });
        await extract("kowalska-crop-3", {
          agreed: { value: BORN, kind: "date", by: "admin" },
          declarationYear: 2021,
        });
        await matchPagesPg("kowalska-crop-2", LATER);
        await matchPagesPg("kowalska-crop-3", LATER);
        expect(await record()).toMatchObject({
          status: "held",
          reason: "no_public_post",
          declinedBy: ADMIN,
        });
      });

      it("puts back on hold a declined page an older release queued", async () => {
        await heldOnAnAdminsDate();
        await declinePublicationPg("kowalska", ADMIN, NOON);
        await edit("declarationPublications/kowalska", {
          status: "queued",
          reason: null,
        });
        const result = await press(0, LATER);
        expect(result.published).toEqual([]);
        expect(await record()).toMatchObject({
          status: "held",
          reason: "admin_decision",
          declinedBy: ADMIN,
        });
        expect((await read("nodes/kowalska"))!.published).toBe(false);
      });

      it("keeps a declined admin's-date hold from a reading that would take it over", async () => {
        await heldOnAnAdminsDate();
        await declinePublicationPg("kowalska", ADMIN, NOON);
        await extract("kowalska-crop-2", { declarationYear: 2022 });
        await matchPagesPg("kowalska-crop-2", LATER);
        expect(await record()).toMatchObject({
          status: "held",
          reason: "admin_decision",
          declinedBy: ADMIN,
        });
        // Put back, the readers' crop takes it over as before.
        await restorePublicationPg("kowalska", LATER);
        await extract("kowalska-crop-3", { declarationYear: 2021 });
        await matchPagesPg("kowalska-crop-3", LATER);
        expect(await record()).toMatchObject({
          status: "queued",
          reason: null,
        });
      });

      it("gives way to a page that went public all the same", async () => {
        await heldForNoPost();
        await declinePublicationPg("kowalska", ADMIN, NOON);
        await edit("nodes/kowalska", { published: true });
        await extract("kowalska-crop-2", { declarationYear: 2022 });
        await matchPagesPg("kowalska-crop-2", LATER);
        const stored = await record();
        expect(stored).toMatchObject({ status: "confirmed", reason: null });
        expect(stored.declinedAt).toBeUndefined();
        expect(stored.declinedBy).toBeUndefined();
      });

      it("puts the page back on hold for what it was held for", async () => {
        await heldForAnotherReading();
        await declinePublicationPg("kowalska", ADMIN, NOON);
        await restorePublicationPg("kowalska", LATER);
        const stored = await record();
        expect(stored).toMatchObject({
          status: "held",
          reason: "conflicting_reading",
        });
        expect(stored.declinedBy).toBeUndefined();
        expect(stored.declinedAt).toBeUndefined();
        await expect(recheck()).resolves.toEqual({
          outcome: "held",
          reason: "conflicting_reading",
        });
      });

      it("refuses what no longer stands in the state it was decided from", async () => {
        await queued();
        for (const decided of [
          declinePublicationPg("kowalska", ADMIN, NOON),
          restorePublicationPg("kowalska", NOON),
        ]) {
          expect((await failure(decided)).statusCode).toBe(409);
        }
        expect(
          (await failure(declinePublicationPg("nobody", ADMIN))).statusCode,
        ).toBe(404);
        expect((await failure(restorePublicationPg("nobody"))).statusCode).toBe(
          404,
        );
      });
    });

    // /api/nodes/publish and /api/revisions/approve call it through
    // afterHandPublicationPg.
    describe("closeHoldOnPublication", () => {
      it("closes a held page, and keeps what it was held for", async () => {
        await heldForNoPost();
        await closeHold("kowalska", LATER);
        // Published, by hand: counted as published wherever a press is.
        expect(await record()).toMatchObject({
          status: "published",
          reason: null,
          autoPublished: false,
          publishedAt: LATER.toISOString(),
          handPublished: {
            uid: ADMIN,
            at: LATER.toISOString(),
            held: "no_public_post",
          },
        });
      });

      it("closes a page somebody declined: whoever publishes it may", async () => {
        await heldForNoPost();
        await declinePublicationPg("kowalska", ADMIN, NOON);
        await closeHold("kowalska", LATER);
        const stored = await record();
        expect(stored).toMatchObject({ status: "published", reason: null });
        expect(stored.declinedAt).toBeUndefined();
      });

      it("is not put back by a sweep after a stale write: it is no publication of the automation's", async () => {
        await heldForNoPost();
        await closeHold("kowalska", NOON);
        // The publication by hand is the admin's on the audit, and the page is
        // a draft again.
        await put("audit/hand-kowalska", {
          action: "publish",
          collection: "nodes",
          target_id: "kowalska",
          user: ADMIN,
          at: NOON.toISOString(),
        });
        await edit("nodes/kowalska", { published: false });
        await sweep(LATER, 0);
        expect((await read("nodes/kowalska"))!.published).toBe(false);
      });

      it("leaves every other record alone, and a page with none", async () => {
        await queued();
        const before = await state();
        await closeHold("kowalska", LATER);
        await closeHold("nobody", LATER);
        expect(await state()).toBe(before);
      });

      it("links a reading's declaration on the page it leaves public", async () => {
        await heldForNoPost();
        await edit("nodes/kowalska", { published: true });
        await closeHold("kowalska", LATER);
        expect((await shown()).map((declaration) => declaration.url)).toEqual([
          LINK,
        ]);
      });

      it("links the declaration of a page published by hand on an admin's date", async () => {
        // The admin who publishes the page does, and the page shows the
        // declaration all the same (decision on 2026-11-18).
        await heldOnAnAdminsDate();
        await edit("nodes/kowalska", { published: true });
        await closeHold("kowalska", LATER);
        expect(await record()).toMatchObject({
          status: "published",
          handPublished: { held: "admin_decision" },
        });
        expect((await shown()).map((declaration) => declaration.url)).toEqual([
          LINK,
        ]);
      });
    });

    describe("reopenHoldOnUnpublication", () => {
      it("puts the hold back on a page taken down after a publication by hand", async () => {
        await heldForNoPost();
        await closeHold("kowalska", NOON);
        await reopenHold("kowalska", LATER);
        const stored = await record();
        expect(stored).toMatchObject({
          status: "held",
          reason: "no_public_post",
          heldAt: LATER.toISOString(),
        });
        expect(stored.handPublished).toBeUndefined();
      });

      it("leaves a publication of the automation's to its own sweep", async () => {
        await queued();
        await drain();
        expect(await record()).toMatchObject({ status: "published" });
        const before = await state();
        await reopenHold("kowalska", LATER);
        expect(await state()).toBe(before);
      });
    });

    describe("readingsOfAnotherDay", () => {
      it("is what the page was held for: a crop named on it, or flagged on it", async () => {
        await heldForAnotherReading();
        // Flagged on her page, and no longer naming it.
        await extract("flagged", {
          agreed: { value: "1990-01-01", kind: "date", by: "readers" },
          personIds: ["nowak"],
        });
        await put(`notes/kowalska_${DECLARATION_ACTOR}`, {
          sources: [{ declarationExtractId: "flagged" }],
        });
        const crops = await readingsOfAnotherDayPg("kowalska", BORN);
        expect(crops.map((crop) => crop.id).sort()).toEqual([
          "flagged",
          "kowalska-crop-2",
        ]);
      });

      it("leaves out a crop with the page's date, and one no longer settled", async () => {
        await heldForAnotherReading();
        await decide("kowalska-crop-2", { verdict: "withdraw" });
        await expect(readingsOfAnotherDayPg("kowalska", BORN)).resolves.toEqual(
          [],
        );
      });
    });
  });
});
