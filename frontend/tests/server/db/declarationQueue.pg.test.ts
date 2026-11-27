import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type postgres from "postgres";
import { confirmedDeclarations } from "~~/server/utils/declarationMatch";
import {
  drainPublicationsPg,
  matchAndDrainPg,
  matchPagesPg,
  publishPagePg,
  readingsOfAnotherDayPg,
} from "~~/server/db/declarationPublish";
import { requeueCropsPg } from "~~/server/db/readingQueue";
import {
  inPeopleImportWindow,
  STUCK_PUBLISHING_MS,
} from "~~/server/utils/declarationRules";
import { waitsForAdmin } from "~~/server/utils/declarationDecisions";
import { DECLARATION_ACTOR, publishLimitOf } from "~~/shared/declarations";
import { approvedRevisionId } from "~~/shared/model";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { PathMirror } from "./pathMirror";

/**
 * What a settled reading does to its pages, on Postgres: the comparison,
 * the publication queue and its passes, an admin's press, the readers'
 * queue after a reading. The cases of the Firestore double this file
 * replaces (tests/server/utils/declarationPublish.test.ts), unchanged in
 * what they arrange and assert: the documents are arranged by
 * `collection/id` in memory, written to their tables before each call to
 * server/db/declarationPublish.ts and read back after it (`PathMirror`), and
 * `writes` counts the rows a call wrote.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationQueue.pg.test.ts
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).createError = (err: any) =>
  Object.assign(new Error(err.message), err);

type Data = Record<string, unknown>;

let sql: postgres.Sql;
const mirror = new PathMirror(() => sql);
const stored = mirror.stored;
let writes = 0;

/** Whether a people import is running, as ops.job_runs says: `unknown` is a
 * table that cannot be read. */
let peopleImport: "idle" | "running" | "unknown" = "idle";

/** A call against the documents as arranged, with what it wrote read back. */
async function run<T>(call: () => Promise<T>): Promise<T> {
  const result = await mirror.around(call, {
    jobRuns:
      peopleImport === "running"
        ? {
            "run-1": {
              job: "people_import",
              state: "running",
              startedAt: NOON.toISOString(),
              heartbeatAt: NOON.toISOString(),
            },
          }
        : {},
    unreadable: peopleImport === "unknown" ? ["ops.job_runs"] : [],
  });
  writes += mirror.lastWrites;
  return result;
}

const matchPages = (id: string, now: Date) => run(() => matchPagesPg(id, now));
const drainPublications = (
  now: Date,
  limit: number,
  options: { maxPages?: number; pressedBy?: string } = {},
) => run(() => drainPublicationsPg(now, limit, options));
const matchAndDrain = (ids: string[], now: Date, limit: number) =>
  run(() => matchAndDrainPg(ids, now, limit));
const publishPage = (id: string, now: Date) =>
  run(() => publishPagePg(id, now));
const readingsOfAnotherDay = (id: string, born: string) =>
  run(() => readingsOfAnotherDayPg(id, born));
const requeueCrops = (ids: string[]) => run(() => requeueCropsPg(ids));

/** An instant as the documents store it. */
const iso = (date: Date) => date.toISOString();

function put(path: string, data: Data) {
  stored.set(path, data);
}

/** `confirmedDeclarations` over the record's crops as the store holds them
 * now, in the record's order, each once - what server/db/declarationPages.ts
 * reads for it. */
function confirmedFromStore(record: Data | undefined, page: Data) {
  const ids = Array.isArray(record?.extractIds)
    ? [...new Set(record.extractIds as string[])]
    : [];
  return confirmedDeclarations(
    ids.flatMap((id) => read(`declarationExtracts/${id}`) ?? []),
    page,
  );
}

function read(path: string): Data | undefined {
  return stored.get(path);
}

/** Every document, keys sorted: what a second run must leave exactly as it
 * was. */
function state(): string {
  return mirror.state();
}

// ---------------------------------------------------------------------------
// The world: Anna Kowalska, a draft councillor of gmina Strzelin since 2024,
// whose 2023 declaration readers have read.
// ---------------------------------------------------------------------------

/** 13:00 in Warsaw: outside the people import's window. */
const NOON = new Date("2026-10-29T12:00:00Z");
/** Ten minutes later, when the next pass comes. */
const LATER = new Date("2026-10-29T12:10:00Z");
/** Long enough before NOON for a claim to count as a pass that died. */
const LONG_AGO = new Date(NOON.getTime() - 16 * 60_000);
const DAY = "2026-10-29";
const BORN = "1979-07-15";
const UNIT = {
  teryt: "021704",
  unitName: "Strzelin (gmina miejsko-wiejska)",
  level: "gmina",
  office: "Rada gminy",
  year: 2024,
};

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

/** A draft written by the people import: the page holds its revision. */
function person(id: string, page: Data = {}, content: Data = {}) {
  const data = {
    type: "person",
    name: "Anna Kowalska",
    birthDate: BORN,
    ...content,
  };
  put(`nodes/${id}`, { ...data, published: false, ...page });
  put(`revisions/rev-${id}`, revision(id, "nodes", data));
}

/** An edge the import wrote and nobody reviewed, holding its revision. */
function edge(id: string, data: Data, own: Data = {}) {
  put(`edges/${id}`, { ...data, published: false });
  put(`revisions/rev-${id}`, { ...revision(id, "edges", data), ...own });
}

function candidacy(id: string, source: string, fields: Data = {}) {
  edge(id, {
    type: "election",
    name: "kandydatura",
    source,
    target: "teryt0217",
    position: "Rada gminy",
    start_date: "2024-01-01",
    elected: true,
    ...fields,
  });
}

function job(id: string, source: string, company: string, fields: Data = {}) {
  edge(id, {
    type: "employed",
    name: "Rada Nadzorcza",
    source,
    target: company,
    start_date: "2020-03-01",
    ...fields,
  });
}

function extract(id: string, fields: Data = {}) {
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
}

/** Her page, her 2024 run in Strzelin, a job at a public company, and her
 * crop - settled, not yet compared. */
function kowalska(id = "kowalska") {
  person(id);
  candidacy(`${id}-run`, id);
  job(`${id}-job`, id, "wodociagi");
  extract(`${id}-crop`, { personIds: [id] });
}

/** The same, queued for publication. */
async function queued(id = "kowalska") {
  kowalska(id);
  await matchPages(`${id}-crop`, NOON);
  expect(read(`declarationPublications/${id}`)).toMatchObject({
    status: "queued",
  });
}

const drain = (limit = 3, now = NOON) => drainPublications(now, limit);

/** Who presses „Opublikuj z kolejki” on /admin/oswiadczenia. */
const ADMIN = "admin-uid";

/** Her press, as /api/declarations/publish-queued sends it: under whatever
 * limit is set, 0 as it ships. */
const press = (limit = 0, now = NOON, options: { maxPages?: number } = {}) =>
  drainPublications(now, limit, { pressedBy: ADMIN, ...options });

/** A reader's request, through /api/revisions/create, to take her page down:
 * the page's data with `deleted`, waiting for a reviewer. */
function removalRequest() {
  put("revisions/removal-by-reader", {
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
}

/** Her page put up by a pass of this automation, as the audit log says. */
function upHere() {
  put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
  put("audit/ours", {
    action: "publish",
    collection: "nodes",
    target_id: "kowalska",
    user: DECLARATION_ACTOR,
    at: "2026-10-29T11:40:00.000Z",
  });
}

/** Every publication of her page in the audit log, in the order filed: who
 * filed it, and whose press it went up at. */
function pagePublications(id = "kowalska") {
  return [...stored.entries()]
    .filter(
      ([path, row]) =>
        path.startsWith("audit/") &&
        row.action === "publish" &&
        row.collection === "nodes" &&
        row.target_id === id,
    )
    .map(([, row]) => ({ user: row.user, pressedBy: row.pressed_by }));
}

describe.runIf(PG_TEST_DATABASE_URL)(
  "declarations, a settled reading and the queue",
  () => {
    beforeAll(async () => {
      sql = await openTestDatabase("declaration_queue");
      // What other writers do in the middle of a call, switched on by a row of
      // test_flags: a second pass claiming the page a pass is publishing, and a
      // database that refuses to move a crop in the readers' queue.
      await sql.unsafe(`
    CREATE TABLE test_flags (name text PRIMARY KEY, value text);
    CREATE FUNCTION test_second_pass() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE claimed text;
    BEGIN
      DELETE FROM test_flags WHERE name = 'second_pass' RETURNING value INTO claimed;
      IF claimed IS NOT NULL AND NEW.data ->> 'status' = 'publishing' THEN
        NEW.data := jsonb_set(NEW.data, '{claimedAt}', to_jsonb(claimed));
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_second_pass BEFORE UPDATE ON declaration_publications
      FOR EACH ROW EXECUTE FUNCTION test_second_pass();
    CREATE FUNCTION test_queue_down() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.data -> 'priority' IS DISTINCT FROM OLD.data -> 'priority'
        AND EXISTS (SELECT 1 FROM test_flags WHERE name = 'queue_down') THEN
        RAISE EXCEPTION 'unavailable';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_queue_down BEFORE UPDATE ON declaration_extracts
      FOR EACH ROW EXECUTE FUNCTION test_queue_down();`);
    }, 120_000);
    afterAll(async () => {
      await closeTestDatabase(sql);
    });

    beforeEach(async () => {
      await sql`TRUNCATE test_flags`;
      stored.clear();
      writes = 0;
      peopleImport = "idle";
      for (const [id, name] of [
        ["teryt0217", "powiat strzeliński"],
        ["teryt0401", "powiat aleksandrowski"],
        ["teryt1465", "Warszawa"],
      ]) {
        put(`nodes/${id}`, { type: "region", name, published: true });
      }
      // The gmina's own water company: the register names the gmina as its
      // shareholder, so a seat on its board is the paid public post every page
      // the automation publishes has to have (`no_public_post`).
      put("nodes/wodociagi", {
        type: "place",
        name: "Wodociągi Strzelin",
        published: true,
        isPublic: true,
      });
      put("nodes/draftco", {
        type: "place",
        name: "Spółka X",
        published: false,
        isPublic: true,
      });
    });

    // Every approval and publication says so in the log.
    vi.spyOn(console, "info").mockImplementation(() => {});

    describe("matchPages", () => {
      it("queues a draft born on the day readers agreed on", async () => {
        kowalska();

        const result = await matchPages("kowalska-crop", NOON);

        expect(result).toMatchObject({
          pageMatch: "same",
          outcomes: { kowalska: "queued" },
          changed: true,
        });
        expect(read("declarationExtracts/kowalska-crop")).toMatchObject({
          pageMatch: "same",
          pageOutcomes: { kowalska: "queued" },
          // Nothing left for a later comparison to find.
          pageRecheck: false,
        });
        expect(read("declarationPublications/kowalska")).toMatchObject({
          personId: "kowalska",
          status: "queued",
          reason: null,
          extractIds: ["kowalska-crop"],
          declarations: [
            {
              url: "https://bip.strzelin.pl/download/kowalska-crop",
              year: 2023,
              unit: "Strzelin (gmina miejsko-wiejska)",
              office: "Rada gminy",
            },
          ],
        });
        // The page is not touched until a pass publishes it.
        expect(read("nodes/kowalska")!.published).toBe(false);
      });

      it("changes nothing when it runs again", async () => {
        kowalska();
        await matchPages("kowalska-crop", NOON);
        const before = state();
        const counted = writes;

        const again = await matchPages(
          "kowalska-crop",
          new Date("2026-10-30T12:00:00Z"),
        );

        expect(again.changed).toBe(false);
        expect(writes).toBe(counted);
        expect(state()).toBe(before);
      });

      it("records a page without a birth date and does nothing else", async () => {
        kowalska();
        put("nodes/kowalska", { ...read("nodes/kowalska")!, birthDate: "" });

        const result = await matchPages("kowalska-crop", NOON);

        expect(result).toMatchObject({
          pageMatch: "no_date",
          outcomes: { kowalska: "no_date" },
        });
        expect(read("declarationExtracts/kowalska-crop")).toMatchObject({
          pageRecheck: true,
        });
        expect(read("declarationPublications/kowalska")).toBeUndefined();
        expect(read(`notes/kowalska_${DECLARATION_ACTOR}`)).toBeUndefined();
      });

      it("flags another birth date with one note, however often it runs", async () => {
        kowalska();
        put("nodes/kowalska", {
          ...read("nodes/kowalska")!,
          birthDate: "1980-01-02",
        });

        const result = await matchPages("kowalska-crop", NOON);
        await matchPages("kowalska-crop", NOON);

        expect(result.pageMatch).toBe("different");
        const note = read(`notes/kowalska_${DECLARATION_ACTOR}`)!;
        expect(note).toMatchObject({
          userUid: DECLARATION_ACTOR,
          nodeId: "kowalska",
        });
        const entries = note.sources as Data[];
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          kind: "change_request",
          url: "https://bip.strzelin.pl/download/kowalska-crop",
          declarationExtractId: "kowalska-crop",
        });
        const text = entries[0]!.note as string;
        expect(text).toContain("Strzelin (gmina miejsko-wiejska)");
        expect(text).toContain("za 2023 r.");
        expect(text).toContain("strona 2 pliku");
        expect(text).toContain("Nic nie zostało zmienione ani odpięte");
        // Neither date, and hyphens only: no en or em dash.
        expect(text).not.toMatch(/1979|1980|[\u2013\u2014]/);
        // Nothing detached, nothing queued.
        expect(read("declarationPublications/kowalska")).toBeUndefined();
        expect(read("edges/kowalska-run")!.source).toBe("kowalska");
      });

      it("links the declaration on a page that is public already", async () => {
        kowalska();
        put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });

        const result = await matchPages("kowalska-crop", NOON);

        expect(result.outcomes).toEqual({ kowalska: "confirmed" });
        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "confirmed",
          declarations: [{ year: 2023, office: "Rada gminy" }],
        });
      });

      it("holds both pages when two of them are born that day", async () => {
        kowalska();
        person("kowalska-2");
        extract("kowalska-crop", { personIds: ["kowalska", "kowalska-2"] });

        const result = await matchPages("kowalska-crop", NOON);

        expect(result.outcomes).toEqual({
          kowalska: "held",
          "kowalska-2": "held",
        });
        for (const id of ["kowalska", "kowalska-2"]) {
          expect(read(`declarationPublications/${id}`)).toMatchObject({
            status: "held",
            reason: "two_pages",
            // Stamped as waiting, or the admin list of held pages, ordered by
            // it, would leave them out.
            queuedAt: iso(NOON),
            heldAt: iso(NOON),
          });
        }
        expect((await drain()).published).toEqual([]);
      });

      it("compares a merged page as the page it went into", async () => {
        kowalska();
        put("nodes/old", {
          type: "person",
          deleted: true,
          merged_into: "kowalska",
        });
        extract("kowalska-crop", { personIds: ["old"] });

        const result = await matchPages("kowalska-crop", NOON);

        expect(result.outcomes).toEqual({ kowalska: "queued" });
      });

      it("compares nothing for a reading that is a year alone", async () => {
        kowalska();
        extract("kowalska-crop", {
          agreed: { value: "1979", kind: "year", by: "readers" },
        });

        const result = await matchPages("kowalska-crop", NOON);

        expect(result).toEqual({
          extractId: "kowalska-crop",
          pageMatch: null,
          outcomes: {},
          changed: false,
        });
        expect(writes).toBe(0);
      });

      it("never writes the page's birth date onto the publication record", async () => {
        await queued();
        await drain();
        expect(
          JSON.stringify(read("declarationPublications/kowalska")),
        ).not.toMatch(/1979/);
      });
    });

    /** An admin's decision on a crop, as /admin/oswiadczenia writes it
     * (server/db/declarationHolds.ts, decideExtractPg): the crop settled on the
     * admin's date, or taken back, and left to be compared again. */
    function adminDecides(id: string, value: string | null) {
      const at = iso(NOON);
      put(`declarationExtracts/${id}`, {
        ...read(`declarationExtracts/${id}`)!,
        status: value ? "agreed" : "withdrawn",
        agreed: value
          ? { value, kind: "date", by: "admin", uid: ADMIN, at }
          : null,
        decision: {
          verdict: value ? "date" : "withdraw",
          value,
          uid: ADMIN,
          at,
        },
        pageMatch: null,
        pageRecheck: false,
      });
    }

    // The admin chose the date on /admin/oswiadczenia with the pages' dates a
    // click away, so it confirms nothing: until decided otherwise, it holds the
    // page and publishes nobody.
    describe("a date an admin settled", () => {
      function settledByAdmin(id: string) {
        extract(id, { status: "disputed", agreed: null });
        adminDecides(id, BORN);
      }

      it("holds a draft born that day for somebody to publish by hand", async () => {
        kowalska();
        settledByAdmin("kowalska-crop");

        const { matched, drain: pass } = await matchAndDrain(
          ["kowalska-crop"],
          NOON,
          3,
        );

        expect(matched).toMatchObject([
          { pageMatch: "same", outcomes: { kowalska: "held" } },
        ]);
        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "held",
          reason: "admin_decision",
          extractIds: ["kowalska-crop"],
          queuedAt: iso(NOON),
          heldAt: iso(NOON),
        });
        expect(pass.published).toEqual([]);
        expect(read("nodes/kowalska")!.published).toBe(false);
      });

      it("never confirms a page that is public already, nor holds it", async () => {
        kowalska();
        put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
        settledByAdmin("kowalska-crop");

        const result = await matchPages("kowalska-crop", NOON);

        expect(result.outcomes).toEqual({ kowalska: "held" });
        expect(read("declarationExtracts/kowalska-crop")).toMatchObject({
          pageMatch: "same",
          pageOutcomes: { kowalska: "held" },
          pageRecheck: false,
        });
        expect(read("declarationPublications/kowalska")).toBeUndefined();
        const before = state();
        await matchPages("kowalska-crop", LATER);
        expect(state()).toBe(before);
      });

      it("still holds a draft that a public page shares the date with", async () => {
        kowalska();
        put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
        person("kowalska-2");
        settledByAdmin("kowalska-crop");
        put("declarationExtracts/kowalska-crop", {
          ...read("declarationExtracts/kowalska-crop")!,
          personIds: ["kowalska", "kowalska-2"],
        });

        const result = await matchPages("kowalska-crop", NOON);

        expect(result.outcomes).toEqual({
          kowalska: "held",
          "kowalska-2": "held",
        });
        expect(read("declarationPublications/kowalska")).toBeUndefined();
        expect(read("declarationPublications/kowalska-2")).toMatchObject({
          status: "held",
          reason: "admin_decision",
        });
      });

      it("joins no record that readers made, and the pass publishes her on theirs alone", async () => {
        await queued();
        const before = read("declarationPublications/kowalska");
        settledByAdmin("kowalska-2022");

        const result = await matchPages("kowalska-2022", NOON);

        expect(result.outcomes).toEqual({ kowalska: "held" });
        expect(read("declarationPublications/kowalska")).toEqual(before);
        expect((await drain()).published).toEqual(["kowalska"]);
        expect(read("declarationPublications/kowalska")).toMatchObject({
          extractIds: ["kowalska-crop"],
          declarations: [
            { url: "https://bip.strzelin.pl/download/kowalska-crop" },
          ],
        });
      });

      it("gives way to readers who match the page later, without the admin's crop", async () => {
        kowalska();
        settledByAdmin("kowalska-crop");
        await matchPages("kowalska-crop", NOON);
        extract("kowalska-2024", { declarationYear: 2024 });

        const result = await matchPages("kowalska-2024", LATER);

        expect(result.outcomes).toEqual({ kowalska: "queued" });
        const record = read("declarationPublications/kowalska")!;
        expect(record).toMatchObject({
          status: "queued",
          reason: null,
          extractIds: ["kowalska-2024"],
          declarations: [
            {
              url: "https://bip.strzelin.pl/download/kowalska-2024",
              year: 2024,
            },
          ],
          queuedAt: iso(LATER),
        });
        expect((record.declarations as unknown[]).length).toBe(1);
        expect((await drain(3, LATER)).published).toEqual(["kowalska"]);
      });

      it("publishes nobody on a crop an admin corrected to the page's new date", async () => {
        await queued();
        const moved = {
          type: "person",
          name: "Anna Kowalska",
          birthDate: "1980-01-02",
        };
        put("nodes/kowalska", { ...moved, published: false });
        put("revisions/rev-kowalska-2", {
          ...revision("kowalska", "nodes", moved),
          update_time: "2026-10-20T02:00:00.000Z",
        });
        await matchPages("kowalska-crop", NOON);
        adminDecides("kowalska-crop", "1980-01-02");
        await matchPages("kowalska-crop", NOON);

        const pass = await drain();

        expect(pass.published).toEqual([]);
        expect(pass.held).toEqual([
          { personId: "kowalska", reason: "no_longer_matches" },
        ]);
        expect(read("nodes/kowalska")!.published).toBe(false);
      });

      it("flags a page born on another day as any reading does", async () => {
        kowalska();
        put("nodes/kowalska", {
          ...read("nodes/kowalska")!,
          birthDate: "1980-01-02",
        });
        settledByAdmin("kowalska-crop");

        const result = await matchPages("kowalska-crop", NOON);

        expect(result.pageMatch).toBe("different");
        const note = read(`notes/kowalska_${DECLARATION_ACTOR}`)!;
        expect(note.sources).toMatchObject([
          { declarationExtractId: "kowalska-crop" },
        ]);
        expect(read("declarationPublications/kowalska")).toBeUndefined();
        expect(waitsForAdmin(read("declarationExtracts/kowalska-crop"))).toBe(
          true,
        );
      });
    });

    // What /api/nodes/<id>/declarations lists on a public page: the record keeps
    // what matched when it was written, and the crops are read again for it.
    describe("confirmedDeclarations", () => {
      const LINK = "https://bip.strzelin.pl/download/kowalska-crop";
      const shown = () =>
        confirmedFromStore(
          read("declarationPublications/kowalska"),
          read("nodes/kowalska")!,
        );

      /** Her page public, confirmed by her crop; the crop also names a
       * namesake's page with no date, so it is compared again later. */
      async function confirmedWithNamesake() {
        kowalska();
        put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
        put("nodes/namesake", {
          type: "person",
          name: "Anna Kowalska",
          published: false,
        });
        extract("kowalska-crop", { personIds: ["kowalska", "namesake"] });
        await matchPages("kowalska-crop", NOON);
        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "confirmed",
          extractIds: ["kowalska-crop"],
        });
      }

      /** A reviewer corrects her date; the next comparison finds the crop
       * contradicted, and it waits for an admin. */
      async function dateCorrected() {
        put("nodes/kowalska", {
          ...read("nodes/kowalska")!,
          birthDate: "1980-01-02",
        });
        await matchPages("kowalska-crop", LATER);
        expect(waitsForAdmin(read("declarationExtracts/kowalska-crop"))).toBe(
          true,
        );
      }

      it("lists each declaration whose crop confirms the page's date, a file once", async () => {
        await confirmedWithNamesake();
        // A second page of the same file, and her declaration of another year.
        extract("kowalska-crop-p2", { url: LINK, page: 2 });
        extract("kowalska-2024", { declarationYear: 2024 });
        await matchPages("kowalska-crop-p2", NOON);
        await matchPages("kowalska-2024", NOON);

        expect(await shown()).toEqual([
          {
            url: LINK,
            year: 2023,
            unit: "Strzelin (gmina miejsko-wiejska)",
            office: "Rada gminy",
          },
          {
            url: "https://bip.strzelin.pl/download/kowalska-2024",
            year: 2024,
            unit: "Strzelin (gmina miejsko-wiejska)",
            office: "Rada gminy",
          },
        ]);
      });

      it("lists nothing once the page's date is corrected, and lists it again with the date", async () => {
        await confirmedWithNamesake();

        await dateCorrected();
        expect(await shown()).toEqual([]);

        put("nodes/kowalska", { ...read("nodes/kowalska")!, birthDate: BORN });
        expect(await shown()).toMatchObject([{ url: LINK }]);
      });

      it("lists nothing for a crop an admin withdrew, though the record still names it", async () => {
        await confirmedWithNamesake();
        await dateCorrected();
        // The correction is undone before the admin takes the crop back, so the
        // dates agree again and only the withdrawal can keep the crop off.
        put("nodes/kowalska", { ...read("nodes/kowalska")!, birthDate: BORN });
        adminDecides("kowalska-crop", null);

        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "confirmed",
          extractIds: ["kowalska-crop"],
        });
        expect(await shown()).toEqual([]);
      });

      it("lists a crop an admin settled again on the page's new date", async () => {
        await confirmedWithNamesake();
        await dateCorrected();
        adminDecides("kowalska-crop", "1980-01-02");
        await matchPages("kowalska-crop", LATER);

        // The crop and the page agree now, on the admin's date: the page shows
        // the declaration (decision on 2026-11-18), and the record readers made
        // is left as it was.
        expect(read("declarationExtracts/kowalska-crop")).toMatchObject({
          agreed: { value: "1980-01-02", by: "admin" },
          pageMatch: "same",
        });
        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "confirmed",
        });
        expect(await shown()).toMatchObject([{ url: LINK }]);
      });

      it("lists nothing on a page without a birth date", async () => {
        await confirmedWithNamesake();
        put("nodes/kowalska", { ...read("nodes/kowalska")!, birthDate: "" });

        expect(await shown()).toEqual([]);
      });
    });

    describe("publishing a queued page", () => {
      it("publishes the page, its candidacy and its KRS jobs, and nothing else", async () => {
        await queued();
        // A namesake's run in Warsaw, and a job at a company still in draft.
        put("nodes/teryt1465", {
          type: "region",
          name: "Warszawa",
          published: true,
        });
        candidacy("kowalska-warsaw", "kowalska", {
          target: "teryt1465",
          position: "Rada miasta",
          start_date: "2018-01-01",
        });
        job("kowalska-draft-job", "kowalska", "draftco");

        const result = await drain();

        expect(result).toMatchObject({
          skipped: null,
          published: ["kowalska"],
          held: [],
          capReached: false,
        });
        const page = read("nodes/kowalska")!;
        expect(page.published).toBe(true);
        expect(typeof page.content_changed_at).toBe("string");
        // The import's revision, approved by the automation on the way up.
        expect(read("revisions/rev-kowalska")).toMatchObject({
          status: "approved",
          review_user: DECLARATION_ACTOR,
        });
        // Then „Inne”, as her KWW run named no party: in a revision of its own,
        // which the page now shows.
        expect(page.parties).toEqual(["Inne"]);
        const shownBy = `revisions/${approvedRevisionId(page.revision_id)}`;
        expect(shownBy).not.toBe("revisions/rev-kowalska");
        expect(read(shownBy)).toMatchObject({
          node_id: "kowalska",
          data: {
            type: "person",
            name: "Anna Kowalska",
            birthDate: BORN,
            parties: ["Inne"],
          },
          status: "approved",
          update_user: DECLARATION_ACTOR,
          update_automatic: true,
          review_user: DECLARATION_ACTOR,
        });
        const audit = [...stored.entries()]
          .filter(([path]) => path.startsWith("audit/"))
          .map(([, row]) => row);
        expect(audit).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: "approve",
              target_id: "kowalska",
              user: DECLARATION_ACTOR,
            }),
            expect.objectContaining({
              action: "publish",
              collection: "nodes",
              target_id: "kowalska",
              user: DECLARATION_ACTOR,
            }),
          ]),
        );
        // Nobody pressed for her: the publication is the automation's alone.
        expect(pagePublications()).toEqual([
          { user: DECLARATION_ACTOR, pressedBy: undefined },
        ]);

        expect(read("edges/kowalska-run")).toMatchObject({ published: true });
        expect(read("revisions/rev-kowalska-run")).toMatchObject({
          status: "approved",
          review_user: DECLARATION_ACTOR,
        });
        expect(read("edges/kowalska-job")).toMatchObject({ published: true });
        expect(read("edges/kowalska-warsaw")!.published).toBe(false);
        expect(read("edges/kowalska-draft-job")!.published).toBe(false);

        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "published",
          autoPublished: true,
          day: DAY,
          approvedRevision: "rev-kowalska",
          edges: {
            published: ["kowalska-run", "kowalska-job"],
            held: [{ id: "kowalska-draft-job", reason: "company_draft" }],
          },
        });
        expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 1,
        });
      });

      it("leaves a job the import's rule would leave, and says why", async () => {
        await queued();
        job("kowalska-hand-job", "kowalska", "wodociagi", {
          start_date: "2021-01-01",
        });
        put("revisions/rev-kowalska-hand-job", {
          ...read("revisions/rev-kowalska-hand-job")!,
          update_automatic: false,
          update_user: "reader-uid",
        });

        await drain();

        expect(read("edges/kowalska-hand-job")!.published).toBe(false);
        expect(read("declarationPublications/kowalska")).toMatchObject({
          edges: { held: [{ id: "kowalska-hand-job", reason: "by_hand" }] },
        });
      });

      describe("the party she goes up with", () => {
        /** Her page, run, job and crop, with `content` on the page, queued. */
        async function queuedWith(content: Data) {
          person("kowalska", {}, content);
          candidacy("kowalska-run", "kowalska");
          job("kowalska-job", "kowalska", "wodociagi");
          extract("kowalska-crop", { personIds: ["kowalska"] });
          await matchPages("kowalska-crop", NOON);
        }

        const revisionsOfHers = () =>
          [...stored.entries()].filter(
            ([path, row]) =>
              path.startsWith("revisions/") && row.node_id === "kowalska",
          );

        it("keeps a party the page names", async () => {
          await queuedWith({ parties: ["PSL"] });

          expect((await drain()).published).toEqual(["kowalska"]);

          const page = read("nodes/kowalska")!;
          expect(page.parties).toEqual(["PSL"]);
          expect(`revisions/${approvedRevisionId(page.revision_id)}`).toBe(
            "revisions/rev-kowalska",
          );
          expect(revisionsOfHers()).toHaveLength(1);
        });

        it("leaves a list a person set, an empty one too", async () => {
          await queuedWith({ parties: [], partiesSource: "manual" });

          expect((await drain()).published).toEqual(["kowalska"]);

          expect(read("nodes/kowalska")!.parties).toEqual([]);
          expect(revisionsOfHers()).toHaveLength(1);
        });

        it("names no party where no paid post goes up with her", async () => {
          await queuedWith({});
          // Her one job is a person's to settle, so the page goes up without it.
          put("revisions/rev-kowalska-job", {
            ...read("revisions/rev-kowalska-job")!,
            update_automatic: false,
            update_user: "reader-uid",
          });

          expect((await drain()).published).toEqual(["kowalska"]);

          expect(read("edges/kowalska-job")!.published).toBe(false);
          expect(read("nodes/kowalska")!.parties).toBeUndefined();
          expect(revisionsOfHers()).toHaveLength(1);
        });

        it("counts a paid post that is up already", async () => {
          await queuedWith({});
          put("edges/kowalska-job", {
            ...read("edges/kowalska-job")!,
            published: true,
          });

          await drain();

          expect(read("nodes/kowalska")!.parties).toEqual(["Inne"]);
        });

        it("files it once, however often a pass comes", async () => {
          await queuedWith({});
          await drain();
          const before = state();

          await drain(3, LATER);

          expect(state()).toBe(before);
        });
      });

      it("leaves the pipeline's committee proposal on the candidacy pending", async () => {
        await queued();
        put("revisions/proposal_kowalska-run_x", {
          ...revision("kowalska-run", "edges", {
            ...(read("revisions/rev-kowalska-run")!.data as Data),
            committee: "KWW Razem dla Strzelina",
          }),
          update_time: "2026-10-02T02:00:00.000Z",
        });

        const result = await drain();

        expect(result.published).toEqual(["kowalska"]);
        expect(read("edges/kowalska-run")).toMatchObject({ published: true });
        expect(read("revisions/proposal_kowalska-run_x")!.status).toBe(
          "pending",
        );
      });

      describe("holds the page", () => {
        async function holds(reason: string) {
          const result = await drain();
          expect(result.held).toEqual([{ personId: "kowalska", reason }]);
          expect(result.published).toEqual([]);
          expect(read("nodes/kowalska")!.published).toBe(false);
          expect(read("edges/kowalska-run")!.published).toBe(false);
          expect(read("edges/kowalska-job")!.published).toBe(false);
          expect(read("declarationPublications/kowalska")).toMatchObject({
            status: "held",
            reason,
          });
          // The slot is given back.
          expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
            count: 0,
          });
        }

        function edit(path: string, fields: Data) {
          put(path, { ...read(path)!, ...fields });
        }

        it("marked as two people", async () => {
          await queued();
          edit("nodes/kowalska", {
            needs_split: { reason: "dwie osoby", at: "", user: "admin" },
          });
          await holds("needs_split");
        });

        it("merged into another page since it was queued", async () => {
          await queued();
          edit("nodes/kowalska", { merged_into: "other", deleted: true });
          await holds("needs_split");
        });

        it("approved and kept hidden by an admin", async () => {
          await queued();
          edit("revisions/rev-kowalska", {
            status: "approved",
            review_user: "admin-uid",
          });
          edit("nodes/kowalska", {
            revision_id: "revisions/rev-kowalska",
          });
          await holds("kept_hidden");
        });

        it("taken off the site before", async () => {
          await queued();
          put("audit/earlier", {
            action: "unpublish",
            collection: "nodes",
            target_id: "kowalska",
            user: "admin-uid",
            at: "2026-10-01T10:00:00.000Z",
          });
          await holds("kept_hidden");
        });

        it("whose newest revision is a person's proposal", async () => {
          await queued();
          put("revisions/proposal-by-reader", {
            ...revision("kowalska", "nodes", {
              type: "person",
              name: "Anna Kowalska-Nowak",
              birthDate: BORN,
            }),
            update_user: "reader-uid",
            update_automatic: false,
            update_time: "2026-10-20T10:00:00.000Z",
          });
          await holds("pending_proposal");
        });

        it("with a person's proposal filed after this automation approved it", async () => {
          await queued();
          // A pass approved the import's revision and stopped before publishing.
          edit("revisions/rev-kowalska", {
            status: "approved",
            review_user: DECLARATION_ACTOR,
          });
          edit("nodes/kowalska", {
            revision_id: "revisions/rev-kowalska",
          });
          put("revisions/proposal-by-reader", {
            ...revision("kowalska", "nodes", {
              type: "person",
              name: "Anna Kowalska-Nowak",
              birthDate: BORN,
            }),
            update_user: "reader-uid",
            update_automatic: false,
            update_time: "2026-10-20T10:00:00.000Z",
          });
          await holds("pending_proposal");
        });

        it("with a reader's request to remove it waiting", async () => {
          await queued();
          // Never a revision the page would go up with, so never the newest one
          // `latestPublishableRevision` names.
          removalRequest();
          await holds("pending_proposal");
          expect(read("revisions/removal-by-reader")!.status).toBe("pending");
        });

        it("with a person's correction older than the import's newest revision", async () => {
          await queued();
          put("revisions/proposal-by-reader", {
            ...revision("kowalska", "nodes", {
              type: "person",
              name: "Anna Kowalska-Nowak",
              birthDate: BORN,
            }),
            update_user: "reader-uid",
            update_automatic: false,
            update_time: "2026-10-05T10:00:00.000Z",
          });
          // The import wrote over the page since, knowing nothing of it.
          edit("revisions/rev-kowalska", {
            update_time: "2026-10-10T02:00:00.000Z",
          });
          await holds("pending_proposal");
        });

        it("whose newest revision a reviewer turned down", async () => {
          await queued();
          // The page holds the import's newest revision, which an admin rejected;
          // an older one of the import's says the same birth date.
          edit("nodes/kowalska", { parties: ["PiS"] });
          edit("revisions/rev-kowalska", {
            data: {
              type: "person",
              name: "Anna Kowalska",
              birthDate: BORN,
              parties: ["PiS"],
            },
            update_time: "2026-10-10T02:00:00.000Z",
            status: "rejected",
            review_user: "admin-uid",
            reject_reason: "to nie ta osoba",
          });
          put(
            "revisions/rev-kowalska-old",
            revision("kowalska", "nodes", {
              type: "person",
              name: "Anna Kowalska",
              birthDate: BORN,
            }),
          );
          await holds("revision_rejected");
          expect(read("revisions/rev-kowalska-old")!.status).toBe("pending");
          expect(read("nodes/kowalska")!.parties).toEqual(["PiS"]);
        });

        it("that no longer shows its newest revision", async () => {
          await queued();
          // Written over outside a revision: approving the revision would take
          // this off the page on its way up.
          edit("nodes/kowalska", {
            wikipedia: "https://pl.wikipedia.org/wiki/Anna_Kowalska",
          });
          await holds("no_revision");
        });

        it("with no revision to approve", async () => {
          await queued();
          stored.delete("revisions/rev-kowalska");
          await holds("no_revision");
        });

        it("whose revision says another birth date", async () => {
          await queued();
          edit("revisions/rev-kowalska", {
            data: {
              type: "person",
              name: "Anna Kowalska",
              birthDate: "1980-01-02",
            },
          });
          await holds("no_revision");
        });

        it("whose birth date changed while it waited", async () => {
          await queued();
          edit("nodes/kowalska", { birthDate: "1980-01-02" });
          await holds("no_longer_matches");
        });

        it("where readers agreed on another name", async () => {
          kowalska();
          edit("declarationExtracts/kowalska-crop", {
            agreedName: "Jan Nowak",
          });
          await matchPages("kowalska-crop", NOON);
          await holds("name_differs");
        });

        it("with nobody paying for a public post on it", async () => {
          await queued();
          // Her only employer is a place nobody could show the public sector
          // owns, which `isPublic: false` says rather than denies.
          edit("nodes/wodociagi", { isPublic: false });
          await holds("no_public_post");
        });

        it("whose only public post somebody took off the graph", async () => {
          await queued();
          edit("edges/kowalska-job", { deleted: true });
          await holds("no_public_post");
        });

        it("whose only public seat is one nobody is paid to sit on", async () => {
          await queued();
          // As an SPZOZ hospital's rada społeczna is: its members are the
          // founding authority's delegates, and the seat is stored under the
          // "Rada Nadzorcza" every supervisory edge carries.
          edit("nodes/wodociagi", { supervisoryBody: "rada-spoleczna" });
          await holds("no_public_post");
        });

        it("holds it ahead of asking about the candidacies", async () => {
          await queued();
          edit("nodes/wodociagi", { isPublic: false });
          // Two candidacies that could be the declaration's: a page with no
          // public post would be held whichever of them was chosen.
          candidacy("kowalska-run-2", "kowalska", { position: "Samorząd" });
          await holds("no_public_post");
        });

        it("without the candidacy the declaration was filed for", async () => {
          await queued();
          edit("edges/kowalska-run", { start_date: "2018-01-01" });
          await holds("no_candidacy_on_page");
        });

        it("with two candidacies that could be it", async () => {
          await queued();
          candidacy("kowalska-run-2", "kowalska", { position: "Samorząd" });
          await holds("ambiguous_candidacy");
        });

        it("whose candidacy a reviewer rejected", async () => {
          await queued();
          put("revisions/rejected", {
            ...revision("kowalska-run", "edges", {}),
            status: "rejected",
            update_time: "2026-10-03T02:00:00.000Z",
          });
          await holds("candidacy_reviewed");
        });

        it("whose candidacy has a person's correction waiting", async () => {
          await queued();
          put("revisions/proposal-by-reader", {
            ...revision("kowalska-run", "edges", { elected: false }),
            update_user: "reader-uid",
            update_automatic: false,
            update_time: "2026-10-03T02:00:00.000Z",
          });
          await holds("candidacy_reviewed");
        });

        it("whose draft candidacies stand in two places in one election", async () => {
          await queued();
          // A namesake's run in another powiat in the same local election,
          // attached as every uncontradicted PKW record is.
          candidacy("kowalska-namesake", "kowalska", { target: "teryt0401" });
          await holds("two_places");
          expect(read("edges/kowalska-namesake")!.published).toBe(false);
        });

        it("with another declaration of hers read as another birth date", async () => {
          await queued();
          extract("kowalska-crop-2", {
            agreed: { value: "1981-02-03", kind: "date", by: "readers" },
            declarationYear: 2022,
          });
          await matchPages("kowalska-crop-2", NOON);
          expect(read(`notes/kowalska_${DECLARATION_ACTOR}`)).toBeDefined();
          await holds("conflicting_reading");
        });

        it("once another page the crop names has the date too", async () => {
          kowalska();
          person("kowalska-2", {}, { birthDate: "" });
          edit("declarationExtracts/kowalska-crop", {
            personIds: ["kowalska", "kowalska-2"],
          });
          await matchPages("kowalska-crop", NOON);
          expect(read("declarationPublications/kowalska")!.status).toBe(
            "queued",
          );
          // The import brings the second page the same date, and the crop has
          // not been compared again yet.
          edit("nodes/kowalska-2", { birthDate: BORN });
          await holds("two_pages");
        });

        it("that would stand in two places in one election", async () => {
          kowalska();
          // The same crop filed for a council in another powiat, in the same
          // local election.
          edit("declarationExtracts/kowalska-crop", {
            units: [
              UNIT,
              {
                ...UNIT,
                teryt: "040100",
                level: "powiat",
                office: "Rada powiatu",
              },
            ],
          });
          candidacy("kowalska-run-2", "kowalska", {
            target: "teryt0401",
            position: "Rada powiatu",
          });
          await matchPages("kowalska-crop", NOON);
          await holds("two_places");
        });
      });

      it("publishes a page the import approved and left a draft", async () => {
        await queued();
        // `autoapprove` approves the import's revision without publishing the
        // page: nobody decided to keep it hidden.
        put("revisions/rev-kowalska", {
          ...read("revisions/rev-kowalska")!,
          status: "approved",
          review_user: "pipeline-people-import",
        });
        put("nodes/kowalska", {
          ...read("nodes/kowalska")!,
          revision_id: "revisions/rev-kowalska",
        });

        const result = await drain();

        expect(result.published).toEqual(["kowalska"]);
        // Approved already, so nothing is approved again.
        expect(read("declarationPublications/kowalska")).toMatchObject({
          approvedRevision: null,
        });
      });

      it("is not held for a request to remove her a reviewer turned down", async () => {
        await queued();
        removalRequest();
        put("revisions/removal-by-reader", {
          ...read("revisions/removal-by-reader")!,
          status: "rejected",
          review_user: "admin-uid",
          reject_reason: "osoba publiczna",
        });

        const result = await drain();

        expect(result.published).toEqual(["kowalska"]);
      });

      it("is not held for a namesake's run a reviewer rejected", async () => {
        await queued();
        candidacy("kowalska-namesake", "kowalska", { target: "teryt0401" });
        put("revisions/rev-kowalska-namesake", {
          ...read("revisions/rev-kowalska-namesake")!,
          status: "rejected",
          review_user: "admin-uid",
        });

        const result = await drain();

        expect(result.published).toEqual(["kowalska"]);
        expect(read("edges/kowalska-run")!.published).toBe(true);
        expect(read("edges/kowalska-namesake")!.published).toBe(false);
      });

      describe("the paid public post it needs on the page", () => {
        /** Her page, queued, with her board seat replaced by `fields`. */
        async function withJob(fields: Data, company: Data = {}) {
          await queued();
          put("nodes/wodociagi", { ...read("nodes/wodociagi")!, ...company });
          put("edges/kowalska-job", {
            ...read("edges/kowalska-job")!,
            ...fields,
          });
        }

        it("counts a post that has ended", async () => {
          await withJob({ start_date: "2015-01-01", end_date: "2019-12-31" });

          const result = await drain();

          expect(result.published).toEqual(["kowalska"]);
        });

        it("counts a post with no dates on record", async () => {
          await withJob({ start_date: null });

          const result = await drain();

          expect(result.published).toEqual(["kowalska"]);
        });

        it("counts a job at a place supervised by an unpaid organ", async () => {
          // The hospital's salaried kierownik, not a seat on its rada społeczna:
          // the organ is unpaid, the role is not a seat on it.
          await withJob(
            { name: "Zarząd" },
            { supervisoryBody: "rada-spoleczna" },
          );

          const result = await drain();

          expect(result.published).toEqual(["kowalska"]);
        });

        it("counts a post at a public company the site has not published", async () => {
          await queued();
          // Her only public post is at a company still in draft: the page goes
          // up, and the relation waits for the company's page.
          put("edges/kowalska-job", {
            ...read("edges/kowalska-job")!,
            deleted: true,
          });
          job("kowalska-draft-job", "kowalska", "draftco");

          const result = await drain();

          expect(result.published).toEqual(["kowalska"]);
          expect(read("edges/kowalska-draft-job")!.published).toBe(false);
          expect(read("declarationPublications/kowalska")).toMatchObject({
            edges: {
              published: ["kowalska-run"],
              held: [{ id: "kowalska-draft-job", reason: "company_draft" }],
            },
          });
        });

        it("does not hold a page that is public already", async () => {
          // A pass cut short after the page went up finishes its relations; the
          // rule is about publishing a draft, and the page is not one.
          await queued();
          put("nodes/wodociagi", {
            ...read("nodes/wodociagi")!,
            isPublic: false,
          });
          await drain();
          expect(read("declarationPublications/kowalska")).toMatchObject({
            status: "held",
            reason: "no_public_post",
          });

          // Somebody publishes her by hand, and the automation meets her again.
          put("nodes/kowalska", {
            ...read("nodes/kowalska")!,
            published: true,
          });
          put("declarationPublications/kowalska", {
            ...read("declarationPublications/kowalska")!,
            status: "queued",
          });

          const result = await drain(3, LATER);

          expect(result.held).toEqual([]);
          expect(result.confirmed).toEqual(["kowalska"]);
        });
      });

      describe("her jobs, by where her birth date came from", () => {
        /** Her page linking register entry 123, as the import's revision does. */
        async function linked(link = "https://rejestr.io/osoby/123") {
          await queued();
          put("nodes/kowalska", {
            ...read("nodes/kowalska")!,
            rejestrIo: link,
          });
          const own = read("revisions/rev-kowalska")!;
          put("revisions/rev-kowalska", {
            ...own,
            data: { ...(own.data as Data), rejestrIo: link },
          });
        }

        /** An older revision that carried the date first. */
        function first(fields: Data, data: Data = {}) {
          put("revisions/first", {
            ...revision("kowalska", "nodes", {
              type: "person",
              name: "Anna Kowalska",
              birthDate: BORN,
              rejestrIo: "https://rejestr.io/osoby/123",
              ...data,
            }),
            status: "approved",
            review_user: "pipeline-people-import",
            update_time: "2026-09-01T02:00:00.000Z",
            ...fields,
          });
        }

        it("publishes them where it came with the entry, however the link is spelled", async () => {
          await linked("https://rejestr.io/osoby/123/anna-kowalska");
          first({});

          const result = await drain();

          expect(result.published).toEqual(["kowalska"]);
          expect(read("edges/kowalska-job")!.published).toBe(true);
        });

        it("holds them where a person typed it", async () => {
          await linked();
          first({
            update_user: "editor-uid",
            update_automatic: false,
            review_user: "admin-uid",
          });

          const result = await drain();

          // The page and the candidacy the declaration is about go up.
          expect(result.published).toEqual(["kowalska"]);
          expect(read("edges/kowalska-run")!.published).toBe(true);
          expect(read("edges/kowalska-job")!.published).toBe(false);
          expect(read("declarationPublications/kowalska")).toMatchObject({
            edges: {
              published: ["kowalska-run"],
              held: [{ id: "kowalska-job", reason: "date_not_from_entry" }],
            },
          });
        });

        it("holds them where it came with another entry", async () => {
          await linked();
          first({}, { rejestrIo: "https://rejestr.io/osoby/999" });

          await drain();

          expect(read("edges/kowalska-job")!.published).toBe(false);
          expect(read("declarationPublications/kowalska")).toMatchObject({
            edges: {
              held: [{ id: "kowalska-job", reason: "date_not_from_entry" }],
            },
          });
        });
      });

      it("publishes a page this automation approved before a pass was cut short", async () => {
        await queued();
        put("revisions/rev-kowalska", {
          ...read("revisions/rev-kowalska")!,
          status: "approved",
          review_user: DECLARATION_ACTOR,
        });
        put("nodes/kowalska", {
          ...read("nodes/kowalska")!,
          revision_id: "revisions/rev-kowalska",
        });

        const result = await drain();

        expect(result.published).toEqual(["kowalska"]);
        expect(read("nodes/kowalska")!.published).toBe(true);
      });

      it("only links a page somebody published while it waited, and gives the slot back", async () => {
        await queued();
        put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
        put("audit/by-admin", {
          action: "publish",
          collection: "nodes",
          target_id: "kowalska",
          user: "admin-uid",
          at: "2026-10-29T11:00:00.000Z",
        });

        const result = await drain();

        expect(result.confirmed).toEqual(["kowalska"]);
        expect(read("edges/kowalska-run")!.published).toBe(false);
        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "confirmed",
        });
        expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 0,
        });
      });
    });

    describe("the daily limit", () => {
      it("publishes oldest first and stops at the limit", async () => {
        await queued("kowalska");
        await queued("nowak");
        // Queued first, so published first.
        put("declarationPublications/nowak", {
          ...read("declarationPublications/nowak")!,
          queuedAt: iso(new Date("2026-10-28T12:00:00Z")),
        });

        const result = await drain(1);

        expect(result).toMatchObject({
          published: ["nowak"],
          capReached: true,
        });
        expect(read("declarationPublications/kowalska")!.status).toBe("queued");
        expect(read("nodes/kowalska")!.published).toBe(false);
        expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 1,
        });

        // The next day has slots again.
        const tomorrow = await drain(1, new Date("2026-10-30T12:00:00Z"));
        expect(tomorrow.published).toEqual(["kowalska"]);
      });

      it("publishes nothing at a limit of 0", async () => {
        await queued();
        const before = state();

        const result = await drain(0);

        expect(result).toMatchObject({ skipped: "off", published: [] });
        expect(state()).toBe(before);
      });

      it("gives a held page's slot to the next one in line", async () => {
        await queued("kowalska");
        await queued("nowak");
        put("nodes/kowalska", {
          ...read("nodes/kowalska")!,
          needs_split: { reason: "dwie osoby", at: "", user: "admin" },
        });
        put("declarationPublications/kowalska", {
          ...read("declarationPublications/kowalska")!,
          queuedAt: iso(new Date("2026-10-28T12:00:00Z")),
        });

        const result = await drain(1);

        expect(result.held).toEqual([
          { personId: "kowalska", reason: "needs_split" },
        ]);
        expect(result.published).toEqual(["nowak"]);
        expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 1,
        });
      });

      it("publishes nothing while a people import is running", async () => {
        await queued();
        peopleImport = "running";
        const before = state();

        const result = await drain();

        expect(result).toMatchObject({ skipped: "import", published: [] });
        expect(state()).toBe(before);
      });

      it("publishes nothing when it cannot tell whether one is running", async () => {
        await queued();
        peopleImport = "unknown";
        vi.spyOn(console, "error").mockImplementationOnce(() => {});

        const result = await drain();

        expect(result).toMatchObject({ skipped: "import", published: [] });
        expect(read("nodes/kowalska")!.published).toBe(false);
      });

      it("publishes nothing while the people import may be running", async () => {
        await queued();
        const before = state();

        // 01:00 and 06:59 in Warsaw are in the window.
        for (const now of ["2026-10-29T00:00:00Z", "2026-10-29T05:59:00Z"]) {
          const result = await drain(3, new Date(now));
          expect(result.skipped).toBe("night");
        }
        expect(state()).toBe(before);

        // 07:00 is not.
        const morning = await drain(3, new Date("2026-10-29T06:00:00Z"));
        expect(morning.published).toEqual(["kowalska"]);
      });
    });

    describe("a pass that was cut short", () => {
      /** Claimed at `claimedAt` by a pass that never finished, its slot taken. */
      async function stuck(claimedAt: Date) {
        await queued();
        put("declarationPublications/kowalska", {
          ...read("declarationPublications/kowalska")!,
          status: "publishing",
          claimedAt: iso(claimedAt),
          day: DAY,
        });
        put(`declarationPublishLimits/${DAY}`, { day: DAY, count: 1 });
      }

      it("is taken up again under the slot it holds", async () => {
        await stuck(new Date(NOON.getTime() - STUCK_PUBLISHING_MS - 60_000));

        const result = await drain(1);

        expect(result.published).toEqual(["kowalska"]);
        expect(read("declarationPublications/kowalska")!.status).toBe(
          "published",
        );
        expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 1,
        });
      });

      it("is left alone while it may still be running", async () => {
        await stuck(new Date(NOON.getTime() - 5 * 60_000));

        const result = await drain(3);

        expect(result.published).toEqual([]);
        expect(read("declarationPublications/kowalska")!.status).toBe(
          "publishing",
        );
      });

      it("finishes the relations of a page it had put up already", async () => {
        await stuck(new Date(NOON.getTime() - STUCK_PUBLISHING_MS - 60_000));
        put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
        put("audit/ours", {
          action: "publish",
          collection: "nodes",
          target_id: "kowalska",
          user: DECLARATION_ACTOR,
          at: "2026-10-29T11:40:00.000Z",
        });

        const result = await drain(1);

        expect(result.published).toEqual(["kowalska"]);
        expect(read("edges/kowalska-run")!.published).toBe(true);
        expect(read("edges/kowalska-job")!.published).toBe(true);
      });

      it("leaves off a candidacy that stands in two places since the page went up", async () => {
        await stuck(LONG_AGO);
        upHere();
        candidacy("kowalska-namesake", "kowalska", { target: "teryt0401" });

        const result = await drain(1);

        expect(result.published).toEqual(["kowalska"]);
        expect(read("edges/kowalska-run")!.published).toBe(false);
        expect(read("edges/kowalska-job")!.published).toBe(true);
        expect(read("declarationPublications/kowalska")).toMatchObject({
          edges: {
            published: ["kowalska-job"],
            held: [{ id: "kowalska-run", reason: "two_places" }],
          },
        });
      });

      it("keeps the slot of a page it put up that was marked as two people since", async () => {
        await stuck(LONG_AGO);
        upHere();
        put("nodes/kowalska", {
          ...read("nodes/kowalska")!,
          needs_split: { reason: "dwie osoby", at: "", user: "admin" },
        });
        await queued("nowak");

        const result = await drain(1);

        // The page is up, so it went up under the day's one slot; nothing more
        // goes up with it, and the next page waits for tomorrow.
        expect(result).toMatchObject({
          published: ["kowalska"],
          held: [],
          capReached: true,
        });
        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "published",
          edges: {
            published: [],
            held: [
              { id: "kowalska-run", reason: "needs_split" },
              { id: "kowalska-job", reason: "needs_split" },
            ],
          },
        });
        expect(read("edges/kowalska-run")!.published).toBe(false);
        expect(read("declarationPublications/nowak")!.status).toBe("queued");
        expect(read("nodes/nowak")!.published).toBe(false);
        expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 1,
        });
      });

      it("finishes a page it put up even at a limit of 0", async () => {
        await stuck(LONG_AGO);
        upHere();

        const result = await drain(0);

        expect(result).toMatchObject({
          skipped: "off",
          published: ["kowalska"],
        });
        expect(read("edges/kowalska-run")!.published).toBe(true);
        expect(read("edges/kowalska-job")!.published).toBe(true);
        expect(read("declarationPublications/kowalska")!.status).toBe(
          "published",
        );
      });

      it("leaves one it had not put up yet at a limit of 0", async () => {
        await stuck(LONG_AGO);
        const before = state();

        const result = await drain(0);

        expect(result).toMatchObject({ skipped: "off", published: [] });
        expect(state()).toBe(before);
      });

      it("gives no slot back once another pass has taken the page up", async () => {
        await stuck(LONG_AGO);
        put("nodes/kowalska", {
          ...read("nodes/kowalska")!,
          needs_split: { reason: "dwie osoby", at: "", user: "admin" },
        });
        // As this pass takes the page up, a second one takes it up again.
        await sql`INSERT INTO test_flags VALUES ('second_pass', ${iso(
          new Date(NOON.getTime() + 1_000),
        )})`;

        const result = await drain(1);

        expect(result.held).toEqual([
          { personId: "kowalska", reason: "needs_split" },
        ]);
        // The second pass's to finish: its record and its slot stay as they are.
        expect(read("declarationPublications/kowalska")!.status).toBe(
          "publishing",
        );
        expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 1,
        });
      });

      it("holds a page a second page with its date came to in the meantime", async () => {
        await stuck(LONG_AGO);
        person("kowalska-2");
        extract("crop-b", { personIds: ["kowalska", "kowalska-2"] });
        await matchPages("crop-b", NOON);
        // Left for the pass that holds the slot, to hold the page and give the
        // slot back.
        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "publishing",
          reason: "two_pages",
        });
        expect(read("declarationPublications/kowalska-2")).toMatchObject({
          status: "held",
          reason: "two_pages",
        });

        const result = await drain(1);

        expect(result.held).toEqual([
          { personId: "kowalska", reason: "two_pages" },
        ]);
        expect(read("nodes/kowalska")!.published).toBe(false);
        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "held",
          reason: "two_pages",
        });
        expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 0,
        });
      });

      it("leaves off a candidacy a reviewer rejected after the page went up", async () => {
        await stuck(new Date(NOON.getTime() - STUCK_PUBLISHING_MS - 60_000));
        put("nodes/kowalska", { ...read("nodes/kowalska")!, published: true });
        put("audit/ours", {
          action: "publish",
          collection: "nodes",
          target_id: "kowalska",
          user: DECLARATION_ACTOR,
          at: "2026-10-29T11:40:00.000Z",
        });
        put("revisions/rev-kowalska-run", {
          ...read("revisions/rev-kowalska-run")!,
          status: "rejected",
        });

        const result = await drain(1);

        expect(result.published).toEqual(["kowalska"]);
        expect(read("edges/kowalska-run")!.published).toBe(false);
        expect(read("revisions/rev-kowalska-run")!.status).toBe("rejected");
        expect(read("edges/kowalska-job")!.published).toBe(true);
        expect(read("declarationPublications/kowalska")).toMatchObject({
          edges: {
            published: ["kowalska-job"],
            held: [{ id: "kowalska-run", reason: "rejected" }],
          },
        });
      });
    });

    // The overview's button publishes past the automatic limit, also while the
    // automatic publication is off: publishing from the queue is an admin's
    // decision. Through the same checks, outside the import's way, and in none
    // of the automation's places of the day.
    describe("an admin's press of „Opublikuj z kolejki”", () => {
      const needsSplit = (id: string) =>
        put(`nodes/${id}`, {
          ...read(`nodes/${id}`)!,
          needs_split: { reason: "dwie osoby", at: "", user: "admin" },
        });

      it("publishes the queue at a limit of 0, in the admin's name and in no place of the day", async () => {
        await queued();

        const result = await press(0);

        expect(result).toMatchObject({
          skipped: null,
          published: ["kowalska"],
          held: [],
          capReached: false,
          waiting: 0,
        });
        expect(read("nodes/kowalska")!.published).toBe(true);
        expect(read("edges/kowalska-run")!.published).toBe(true);
        expect(read("edges/kowalska-job")!.published).toBe(true);
        const record = read("declarationPublications/kowalska")!;
        expect(record).toMatchObject({
          status: "published",
          pressedBy: ADMIN,
          // So her page never says the site published it on its own.
          autoPublished: false,
        });
        // No place of the day was taken: none is counted, none is named.
        expect(record.day).toBeUndefined();
        expect(read(`declarationPublishLimits/${DAY}`)).toBeUndefined();
        // The checks and the writes are still the automation's, which is what a
        // later pass recognises as its own to finish or put back. The admin is
        // named beside it: the activity counts the publication as theirs.
        expect(pagePublications()).toEqual([
          { user: DECLARATION_ACTOR, pressedBy: ADMIN },
        ]);
      });

      it("goes past a limit already reached and leaves the automation's count as it was", async () => {
        await queued("kowalska");
        await queued("nowak");
        put(`declarationPublishLimits/${DAY}`, { day: DAY, count: 2 });
        expect(await drain(2)).toMatchObject({
          published: [],
          capReached: true,
        });

        const result = await press(2);

        expect(result).toMatchObject({
          published: ["kowalska", "nowak"],
          capReached: false,
          waiting: 0,
        });
        expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 2,
        });
      });

      it("publishes nobody inside the people import's night window", async () => {
        await queued();
        const before = state();

        for (const now of ["2026-10-29T00:00:00Z", "2026-10-29T05:59:00Z"]) {
          expect(await press(0, new Date(now))).toMatchObject({
            skipped: "night",
            published: [],
            waiting: 1,
          });
        }
        expect(state()).toBe(before);
      });

      it("publishes nobody while a people import runs, or when it cannot tell", async () => {
        await queued();
        const before = state();

        peopleImport = "running";
        expect(await press()).toMatchObject({
          skipped: "import",
          published: [],
          waiting: 1,
        });

        peopleImport = "unknown";
        vi.spyOn(console, "error").mockImplementationOnce(() => {});
        expect(await press()).toMatchObject({
          skipped: "import",
          published: [],
        });
        expect(state()).toBe(before);
      });

      it("holds a page a check stops, and has no place of the day to give back", async () => {
        await queued("kowalska");
        await queued("nowak");
        needsSplit("kowalska");
        // The automation's one place today, taken by a page of its own.
        put(`declarationPublishLimits/${DAY}`, { day: DAY, count: 1 });

        const result = await press(1);

        expect(result.held).toEqual([
          { personId: "kowalska", reason: "needs_split" },
        ]);
        expect(result.published).toEqual(["nowak"]);
        expect(read("nodes/kowalska")!.published).toBe(false);
        expect(read("declarationPublications/kowalska")).toMatchObject({
          status: "held",
          reason: "needs_split",
          pressedBy: ADMIN,
        });
        expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
          count: 1,
        });
      });

      it("takes up only the queue: a held page stays for somebody to decide", async () => {
        kowalska();
        person("kowalska-2");
        extract("kowalska-crop", { personIds: ["kowalska", "kowalska-2"] });
        await matchPages("kowalska-crop", NOON);
        const before = state();

        expect(await press()).toMatchObject({
          published: [],
          held: [],
          waiting: 0,
        });
        expect(state()).toBe(before);
      });

      it("takes up a batch at most, and says how many still wait", async () => {
        for (const id of ["a", "b", "c"]) await queued(id);

        const result = await press(0, NOON, { maxPages: 2 });

        expect(result).toMatchObject({ published: ["a", "b"], waiting: 1 });
        expect(read("declarationPublications/c")!.status).toBe("queued");
      });

      describe("cut short", () => {
        /** Her page taken up by a press whose request died. */
        async function pressedAndStuck() {
          await queued();
          put("declarationPublications/kowalska", {
            ...read("declarationPublications/kowalska")!,
            status: "publishing",
            claimedAt: iso(LONG_AGO),
            pressedBy: ADMIN,
          });
          // The automation's one place today is another page's.
          put(`declarationPublishLimits/${DAY}`, { day: DAY, count: 1 });
        }

        it("is finished as the admin's by the automation's next pass, in no place", async () => {
          await pressedAndStuck();

          const result = await drain(1);

          expect(result.published).toEqual(["kowalska"]);
          const record = read("declarationPublications/kowalska")!;
          expect(record).toMatchObject({
            status: "published",
            pressedBy: ADMIN,
            autoPublished: false,
          });
          expect(record.day).toBeUndefined();
          expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
            count: 1,
          });
          expect(pagePublications()).toEqual([
            { user: DECLARATION_ACTOR, pressedBy: ADMIN },
          ]);
        });

        it("gives no place back when it is held on the second try", async () => {
          await pressedAndStuck();
          needsSplit("kowalska");

          const result = await drain(1);

          expect(result.held).toEqual([
            { personId: "kowalska", reason: "needs_split" },
          ]);
          expect(read(`declarationPublishLimits/${DAY}`)).toMatchObject({
            count: 1,
          });
        });
      });

      it("is forgotten when the automation itself claims a page queued again", async () => {
        await queued();
        // Pressed for once and found public by then; a draft again since, and
        // queued anew with the press still on its record.
        put("declarationPublications/kowalska", {
          ...read("declarationPublications/kowalska")!,
          pressedBy: ADMIN,
        });

        expect((await drain(3)).published).toEqual(["kowalska"]);

        const record = read("declarationPublications/kowalska")!;
        expect(record).toMatchObject({ autoPublished: true, day: DAY });
        expect(record.pressedBy).toBeUndefined();
        expect(pagePublications()).toEqual([
          { user: DECLARATION_ACTOR, pressedBy: undefined },
        ]);
      });

      it("forgets the place of the day an earlier claim left on a page queued again", async () => {
        await queued();
        put("declarationPublications/kowalska", {
          ...read("declarationPublications/kowalska")!,
          day: "2026-10-20",
        });

        expect((await press()).published).toEqual(["kowalska"]);

        expect(read("declarationPublications/kowalska")!.day).toBeUndefined();
      });
    });

    describe("the readers' queue after a reading", () => {
      /** Another declaration of hers, cut and waiting for readers. */
      function open(id: string, fields: Data = {}) {
        put(`declarationExtracts/${id}`, {
          status: "open",
          priority: 0,
          answerCount: 0,
          rand: 0.5,
          personIds: ["kowalska"],
          units: [UNIT],
          ...fields,
        });
      }
      const priorityOf = (id: string) =>
        read(`declarationExtracts/${id}`)?.priority;

      it("sends her other crops to the last tier once a reading reaches her, and leaves another person's", async () => {
        kowalska();
        open("hers-2022");
        open("hers-2021", {
          priority: 0.5,
          machine: { birthDate: "1981-02-03" },
        });
        // A council's file that names Jan Nowak too, who has no reading yet and
        // no paid post on his draft.
        person("nowak", {}, { name: "Jan Nowak" });
        open("theirs", { personIds: ["kowalska", "nowak"] });

        await matchAndDrain(["kowalska-crop"], NOON, 0);

        expect(read("declarationExtracts/kowalska-crop")).toMatchObject({
          pageMatch: "same",
        });
        expect(priorityOf("hers-2022")).toBe(4);
        expect(priorityOf("hers-2021")).toBe(4);
        expect(priorityOf("theirs")).toBe(2);

        // Nothing left to move.
        const before = writes;
        expect(await requeueCrops(["kowalska", "nowak"])).toBe(0);
        expect(writes).toBe(before);
      });

      it("sends a crop of two people last once both have a reading", async () => {
        kowalska();
        person("nowak", {}, { name: "Jan Nowak" });
        // His own declaration, read and compared some time ago.
        extract("nowak-crop", {
          personIds: ["nowak"],
          pageMatch: "same",
          pageOutcomes: { nowak: "queued" },
        });
        open("theirs", { personIds: ["kowalska", "nowak"] });

        await matchAndDrain(["kowalska-crop"], NOON, 0);

        expect(priorityOf("theirs")).toBe(4);
      });

      it("counts a reading of another day as reaching her too", async () => {
        kowalska();
        extract("kowalska-crop", {
          agreed: {
            value: "1980-01-01",
            kind: "date",
            by: "readers",
            readers: 2,
          },
        });
        open("hers-2022");

        await matchAndDrain(["kowalska-crop"], NOON, 0);

        expect(read("declarationExtracts/kowalska-crop")).toMatchObject({
          pageMatch: "different",
        });
        expect(priorityOf("hers-2022")).toBe(4);
      });

      it("never fails what moved it", async () => {
        kowalska();
        open("hers-2022");
        await sql`INSERT INTO test_flags VALUES ('queue_down', NULL)`;
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(
          matchAndDrain(["kowalska-crop"], NOON, 0),
        ).resolves.toMatchObject({ matched: [{ pageMatch: "same" }] });
        expect(priorityOf("hers-2022")).toBe(0);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
      });
    });

    describe("what an admin does about a held page", () => {
      const record = (id = "kowalska") =>
        read(`declarationPublications/${id}`)!;
      /** Her page, held because another of her declarations reads another day. */
      async function heldForAnotherReading() {
        await queued();
        extract("kowalska-crop-2", {
          agreed: { value: "1981-02-03", kind: "date", by: "readers" },
          declarationYear: 2022,
        });
        await matchPages("kowalska-crop-2", NOON);
        await drain();
        expect(record()).toMatchObject({
          status: "held",
          reason: "conflicting_reading",
        });
      }

      describe("readingsOfAnotherDay", () => {
        it("is what the page was held for: a crop named on it, or flagged on it", async () => {
          await heldForAnotherReading();
          // Flagged on her page, and no longer naming it.
          extract("flagged", {
            agreed: { value: "1990-01-01", kind: "date", by: "readers" },
            personIds: ["nowak"],
          });
          put(`notes/kowalska_${DECLARATION_ACTOR}`, {
            sources: [{ declarationExtractId: "flagged" }],
          });

          const crops = await readingsOfAnotherDay("kowalska", BORN);

          expect(crops.map((crop) => crop.id).sort()).toEqual([
            "flagged",
            "kowalska-crop-2",
          ]);
        });

        it("leaves out a crop with the page's date, and one no longer settled", async () => {
          await heldForAnotherReading();
          adminDecides("kowalska-crop-2", null);

          await expect(readingsOfAnotherDay("kowalska", BORN)).resolves.toEqual(
            [],
          );
        });
      });
    });

    describe("publishLimitOf", () => {
      it("reads the limit as a whole number, and anything else as off", () => {
        expect(publishLimitOf({ declarationsDailyPublishLimit: 0 })).toBe(0);
        expect(publishLimitOf({})).toBe(0);
        // An environment override arrives as whatever destr made of the string.
        expect(publishLimitOf({ declarationsDailyPublishLimit: "10" })).toBe(
          10,
        );
        expect(publishLimitOf({ declarationsDailyPublishLimit: 2.7 })).toBe(2);
        expect(publishLimitOf({ declarationsDailyPublishLimit: -1 })).toBe(0);
        expect(publishLimitOf({ declarationsDailyPublishLimit: "dużo" })).toBe(
          0,
        );
      });
    });

    describe("inPeopleImportWindow", () => {
      it("is 01:00 to 07:00 on a Warsaw clock, in summer time too", () => {
        expect(inPeopleImportWindow(new Date("2026-10-28T23:59:00Z"))).toBe(
          false,
        );
        expect(inPeopleImportWindow(new Date("2026-10-29T00:00:00Z"))).toBe(
          true,
        );
        expect(inPeopleImportWindow(new Date("2026-10-29T06:00:00Z"))).toBe(
          false,
        );
        // 01:30 in Warsaw is 23:30 UTC the day before in July.
        expect(inPeopleImportWindow(new Date("2026-06-30T23:30:00Z"))).toBe(
          true,
        );
        expect(inPeopleImportWindow(new Date("2026-07-01T05:00:00Z"))).toBe(
          false,
        );
      });
    });

    describe("publishPage", () => {
      it("holds a page with nothing queued for it", async () => {
        kowalska();
        expect(await publishPage("kowalska", NOON)).toEqual({
          status: "held",
          reason: "no_longer_matches",
        });
      });
    });
  },
);
