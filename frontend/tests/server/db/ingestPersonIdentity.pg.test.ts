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
import handler from "~~/server/api/ingest/person.post";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  type TestEvent,
} from "./pgHarness";

/** POST /api/ingest/person on Postgres, the page a payload lands on and the
 * jobs it writes there: one register entry is one human, a `korytaId` that
 * names a page storing another birth date or linking another entry holds the
 * payload back, somebody only an odpis names is found by name and birth date,
 * and a published page linking the payload's entry gets its jobs live.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/ingestPersonIdentity.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.readValidatedBody = async (
    event: { body?: unknown },
    parse: (b: unknown) => unknown,
  ) => parse(event.body);
  // The 404 status itself is set through h3; the body is what is checked.
  g.setResponseStatus = () => {};
  g.useStorage = () => ({ clear: async () => {} });
});
vi.mock("~~/server/utils/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/utils/auth")>();
  return {
    ...actual,
    getUser: async (event: TestEvent) => {
      const header = event.headers.authorization;
      if (!header) throw Object.assign(new Error("401"), { statusCode: 401 });
      const [uid, ...claims] = header.split(",");
      return { uid, ...Object.fromEntries(claims.map((c) => [c, true])) };
    },
  };
});

type Doc = Record<string, unknown>;
type Row = { id: string; data: Doc };
type Answer = {
  personId: string;
  person: string;
  companies: Doc[];
  articles: Doc[];
  elections: Doc[];
  unplacedEmployments?: Doc[];
  droppedChanges?: Doc[];
  status: string;
  message?: string;
  data?: string[];
};

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;
let as = "test-user-id,datascience";

async function ingest(body: Doc) {
  await store.sync(sql);
  const event = {
    headers: { authorization: as },
    context: {},
    body,
  } as TestEvent;
  return (handler as unknown as (e: TestEvent) => Promise<Answer>)(event);
}

/** The error a refused request threw. */
async function refusal(body: Doc) {
  try {
    await ingest(body);
  } catch (error) {
    return error as { statusCode?: number; message?: string };
  }
  throw new Error("the request was taken");
}

async function doc(t: "nodes" | "edges" | "revisions", id: string) {
  const [row] = await sql<{ data: Doc }[]>`
    SELECT data FROM ${sql(t)} WHERE id = ${id}`;
  return row?.data;
}

async function all(t: "nodes" | "edges" | "revisions" | "audit") {
  return sql<Row[]>`SELECT id, data FROM ${sql(t)} ORDER BY id`;
}

/** The revisions written onto a document, oldest first. */
async function revisionsOf(id: string) {
  return sql<Row[]>`
    SELECT id, data FROM revisions WHERE data->>'node_id' = ${id}
    ORDER BY data->>'update_time', id`;
}

const person = (fields: Doc) => ({ type: "person", parties: [], ...fields });

describe.runIf(PG_TEST_DATABASE_URL)(
  "POST /api/ingest/person, identity",
  () => {
    beforeAll(async () => {
      sql = await openTestDatabase("ingest_person_ident");
    }, 120_000);
    afterAll(async () => {
      await closeTestDatabase(sql);
    });
    beforeEach(() => {
      store.clear();
      as = "test-user-id,datascience";
    });

    describe("one register entry is one human", () => {
      const payload = (body: Doc) => ({
        parties: [],
        companies: [],
        elections: [],
        ...body,
      });

      it("matches a stored person whose name the pipeline spelled differently this run", async () => {
        table("nodes").golimont = person({
          name: "Andrzej Marcin Golimont",
          rejestrIo: "383093",
        });
        const result = await ingest(
          payload({ name: "Andrzej Golimont", rejestrIo: "383093" }),
        );
        expect(result.personId).toBe("golimont");
        expect(result.person).toBe("unchanged");
        expect((await all("nodes")).map((n) => n.id)).toEqual(["golimont"]);
        expect(await all("revisions")).toEqual([]);
      });

      it("gives a second register entry its own page instead of overwriting the first", async () => {
        table("nodes").nowak1961 = person({
          name: "Michał Nowak",
          rejestrIo: "111111",
        });
        const result = await ingest(
          payload({ name: "Michał Nowak", rejestrIo: "222222" }),
        );
        expect(result.person).toBe("created");
        expect(result.personId).not.toBe("nowak1961");
        const [revision] = await revisionsOf(result.personId);
        expect(revision!.data).toMatchObject({
          update_user: "test-user-id",
          data: { name: "Michał Nowak", type: "person", rejestrIo: "222222" },
        });
        expect(await revisionsOf("nowak1961")).toEqual([]);
        expect(await doc("nodes", "nowak1961")).toMatchObject({
          rejestrIo: "111111",
        });
      });

      it("takes the page of its name that links its entry the way a browser writes it", async () => {
        table("nodes").stary = person({
          name: "Jan Kowalski",
          rejestrIo: "https://rejestr.io/osoby/999999/jan-kowalski",
        });
        const result = await ingest(
          payload({
            name: "Jan Kowalski",
            rejestrIo: "https://rejestr.io/osoby/999999",
          }),
        );
        expect(result.personId).toBe("stary");
        const [revision] = await revisionsOf("stary");
        expect(revision!.data.data).toMatchObject({
          rejestrIo: "https://rejestr.io/osoby/999999",
        });
      });

      it("gives another entry its own page however the stored link is written", async () => {
        table("nodes").nowak1961 = person({
          name: "Michał Nowak",
          rejestrIo: "https://rejestr.io/osoby/111111/michal-nowak",
        });
        const result = await ingest(
          payload({
            name: "Michał Nowak",
            rejestrIo: "https://rejestr.io/osoby/222222",
          }),
        );
        expect(result.person).toBe("created");
        expect(result.personId).not.toBe("nowak1961");
        expect(await revisionsOf(result.personId)).toHaveLength(1);
        expect(await revisionsOf("nowak1961")).toEqual([]);
      });

      it("adopts the register entry onto a person stored without one", async () => {
        table("nodes").stary = person({ name: "Jan Kowalski" });
        const result = await ingest(
          payload({ name: "Jan Kowalski", rejestrIo: "999999" }),
        );
        expect(result.personId).toBe("stary");
        expect(result.person).toBe("updated");
        const [revision] = await revisionsOf("stary");
        expect(revision!.data.data).toMatchObject({ rejestrIo: "999999" });
      });

      it("adopts the entry onto a page writing its double surname with a space", async () => {
        table("nodes").stary = person({ name: "Anna Nowak Rudnik" });
        const result = await ingest(
          payload({ name: "Anna Nowak-Rudnik", rejestrIo: "999999" }),
        );
        expect(result.personId).toBe("stary");
        expect(await revisionsOf("stary")).toHaveLength(1);
        expect((await all("nodes")).map((n) => n.id)).toEqual(["stary"]);
      });

      it("takes the page of the exact hyphenated name first", async () => {
        Object.assign(table("nodes"), {
          spaced: person({ name: "Anna Nowak Rudnik" }),
          hyphenated: person({ name: "Anna Nowak-Rudnik" }),
        });
        const result = await ingest(payload({ name: "Anna Nowak-Rudnik" }));
        expect(result.personId).toBe("hyphenated");
      });

      it("still matches by name when the payload names no register entry", async () => {
        table("nodes").stary = person({
          name: "Jan Kowalski",
          rejestrIo: "999999",
        });
        const result = await ingest(payload({ name: "Jan Kowalski" }));
        expect(result.personId).toBe("stary");
        expect(await all("revisions")).toEqual([]);
      });

      it("never matches an article that happens to carry the person's name", async () => {
        table("nodes").artykul = { type: "article", name: "Paweł Obermeyer" };
        const result = await ingest(
          payload({ name: "Paweł Obermeyer", parties: ["PiS"] }),
        );
        expect(result.person).toBe("created");
        expect(result.personId).not.toBe("artykul");
        expect(await revisionsOf("artykul")).toEqual([]);
        expect(await doc("nodes", "artykul")).toEqual({
          type: "article",
          name: "Paweł Obermeyer",
        });
      });

      it("matches the page the pipeline named, whatever it is called there", async () => {
        table("nodes").halina = person({ name: "HALINA CZAPLA" });
        const result = await ingest(
          payload({ name: "Halina Anna Czapla", korytaId: "halina" }),
        );
        expect(result.personId).toBe("halina");
        expect(await all("revisions")).toEqual([]);
      });

      it("follows a page merged away since the export the pipeline read", async () => {
        Object.assign(table("nodes"), {
          duplicate: person({
            name: "Andrzej Marcin Golimont",
            deleted: true,
            merged_into: "survivor",
          }),
          survivor: person({ name: "Andrzej Golimont", rejestrIo: "383093" }),
        });
        const result = await ingest(
          payload({ name: "Andrzej Golimont", korytaId: "duplicate" }),
        );
        expect(result.personId).toBe("survivor");
      });

      it("follows a merge reached through the register entry", async () => {
        Object.assign(table("nodes"), {
          duplicate: person({
            name: "TAIDA MUCHLA JASTRZĘBSKA",
            rejestrIo: "3532381",
            deleted: true,
            merged_into: "survivor",
          }),
          survivor: person({
            name: "Taida Muchla Jastrzębska",
            rejestrIo: "3532381",
          }),
        });
        const result = await ingest(
          payload({ name: "Taida Muchla Jastrzębska", rejestrIo: "3532381" }),
        );
        expect(result.personId).toBe("survivor");
      });

      it("follows a merge reached through the name", async () => {
        Object.assign(table("nodes"), {
          duplicate: person({
            name: "Andrzej Marcin Golimont",
            deleted: true,
            merged_into: "survivor",
          }),
          survivor: person({ name: "Andrzej Golimont" }),
        });
        const result = await ingest(
          payload({ name: "Andrzej Marcin Golimont" }),
        );
        expect(result.personId).toBe("survivor");
      });

      it("ignores a korytaId that has come to name something other than a person", async () => {
        Object.assign(table("nodes"), {
          article: { type: "article", name: "Paweł Obermeyer" },
          pawel: person({ name: "Paweł Obermeyer", rejestrIo: "1956879" }),
        });
        const result = await ingest(
          payload({
            name: "Paweł Obermeyer",
            korytaId: "article",
            rejestrIo: "1956879",
          }),
        );
        expect(result.personId).toBe("pawel");
      });

      describe("a page the korytaId names that stores another birth date", () => {
        // Krzysztof Hetman's page, as the 2026-10-10 export has it.
        const hetman = person({
          name: "Krzysztof Hetman",
          birthDate: "1974-06-27",
          rejestrIo: "",
          wikipedia: "https://pl.wikipedia.org/wiki/Krzysztof_Hetman",
          parties: ["PSL"],
          published: true,
        });
        beforeEach(() => {
          Object.assign(table("nodes"), {
            hetman: { ...hetman },
            company: {
              type: "place",
              name: "Spółka",
              krsNumber: "0000087470",
              published: true,
            },
          });
        });

        const namesake = (body: Doc = {}) =>
          payload({
            name: "Krzysztof Hetman",
            korytaId: "hetman",
            rejestrIo: "https://rejestr.io/osoby/1203566",
            birthDate: "1963-10-10",
            companies: [
              {
                krs: "0000087470",
                role: "Zarząd",
                start: "2006-11-24",
                end: "2021-06-24",
              },
            ],
            ...body,
          });

        it("holds the payload back, nothing written", async () => {
          expect(await refusal(namesake())).toMatchObject({
            statusCode: 409,
            message: expect.stringContaining("(hetman) stores 1974-06-27"),
          });
          expect(await all("revisions")).toEqual([]);
          expect(await all("edges")).toEqual([]);
          expect(await doc("nodes", "hetman")).toEqual(hetman);
        });

        it("does not look for another page instead", async () => {
          table("nodes").other = person({
            name: "Krzysztof Hetman",
            birthDate: "1963-10-10",
          });
          expect((await refusal(namesake())).statusCode).toBe(409);
          expect(await all("revisions")).toEqual([]);
          expect((await all("nodes")).map((n) => n.id)).toEqual([
            "company",
            "hetman",
            "other",
          ]);
        });

        it("holds it back where the page stores only a year, and another", async () => {
          table("nodes").hetman!.birthDate = "1974";
          expect((await refusal(namesake())).statusCode).toBe(409);
        });

        it("takes a payload born in the year the page stores alone", async () => {
          table("nodes").hetman!.birthDate = "1963";
          expect((await ingest(namesake())).personId).toBe("hetman");
        });

        it("takes the payload where the page stores no birth date", async () => {
          table("nodes").hetman!.birthDate = "";
          expect((await ingest(namesake())).personId).toBe("hetman");
        });

        it("takes the payload born on the day the page stores", async () => {
          expect(
            (await ingest(namesake({ birthDate: "1974-06-27" }))).personId,
          ).toBe("hetman");
        });

        it("takes a payload with no birth date, as before", async () => {
          expect(
            (await ingest(namesake({ birthDate: undefined }))).personId,
          ).toBe("hetman");
        });

        it("takes the payload of the register entry the page links, keeping its date", async () => {
          table("nodes").hetman!.rejestrIo =
            "https://rejestr.io/osoby/1203566/krzysztof-hetman";
          const result = await ingest(namesake());
          expect(result.personId).toBe("hetman");
          for (const { data } of await all("revisions"))
            expect(data.data).not.toMatchObject({ birthDate: "1963-10-10" });
          expect((await doc("nodes", "hetman"))!.birthDate).toBe("1974-06-27");
        });
      });

      it("falls back to the register entry when the korytaId names nothing", async () => {
        table("nodes").pawel = person({
          name: "Paweł Obermeyer",
          rejestrIo: "1956879",
        });
        const result = await ingest(
          payload({
            name: "Paweł Obermeyer",
            korytaId: "gone",
            rejestrIo: "1956879",
          }),
        );
        expect(result.personId).toBe("pawel");
      });

      describe("a page reached by its id under another entry's link", () => {
        // Tadeusz Rozpara's, as the 10-06 plan had it.
        const OWN = "https://rejestr.io/osoby/1220490";
        const NAMESAKE = "https://rejestr.io/osoby/670747";

        beforeEach(() => {
          Object.assign(table("nodes"), {
            rozpara: person({
              name: "Tadeusz Rozpara",
              rejestrIo: OWN,
              parties: ["SLD"],
              published: true,
            }),
            company: {
              type: "place",
              name: "Spółka",
              krsNumber: "0000012345",
              published: true,
            },
          });
        });

        /** The data of the revision written to the person, if one was. */
        async function writtenPerson() {
          const [revision] = await revisionsOf("rozpara");
          return revision?.data.data as Doc | undefined;
        }

        const namesake = (body: Doc = {}) =>
          payload({
            name: "Tadeusz Rozpara",
            korytaId: "rozpara",
            rejestrIo: NAMESAKE,
            birthDate: "1953-12-01",
            companies: [
              { krs: "0000012345", role: "Zarząd", start: "2010-01-01" },
            ],
            ...body,
          });

        it("holds the payload back, nothing written", async () => {
          expect(await refusal(namesake())).toMatchObject({
            statusCode: 409,
            message:
              "Tadeusz Rozpara, rejestr.io entry 670747: the page the payload " +
              "names (rozpara) links entry 1220490; held",
          });
          expect(await all("revisions")).toEqual([]);
          expect(await all("edges")).toEqual([]);
          expect((await doc("nodes", "rozpara"))!.rejestrIo).toBe(OWN);
        });

        it("holds a draft's payload back as well", async () => {
          table("nodes").rozpara!.published = false;
          expect((await refusal(namesake())).statusCode).toBe(409);
          expect(await all("revisions")).toEqual([]);
        });

        it("does not look for another page instead", async () => {
          table("nodes").namesake = person({
            name: "Tadeusz Rozpara",
            rejestrIo: NAMESAKE,
          });
          expect((await refusal(namesake())).statusCode).toBe(409);
          expect(await all("revisions")).toEqual([]);
        });

        it("says the page stores another birth date first, where it does", async () => {
          table("nodes").rozpara!.birthDate = "1953-12-01";
          expect(
            await refusal(namesake({ birthDate: "1952-04-25" })),
          ).toMatchObject({
            statusCode: 409,
            message: expect.stringContaining(
              "(rozpara) stores 1953-12-01; held",
            ),
          });
        });

        it("holds back a payload whose entry was merged into a page linking another", async () => {
          table("nodes").tombstone = person({
            name: "Tadeusz Rozpara",
            rejestrIo: NAMESAKE,
            deleted: true,
            merged_into: "rozpara",
          });
          expect(
            await refusal(namesake({ korytaId: undefined })),
          ).toMatchObject({
            statusCode: 409,
            message: expect.stringContaining(
              "the page its entry was merged into (rozpara) links entry 1220490",
            ),
          });
          expect(await all("revisions")).toEqual([]);
        });

        it.each([
          ["the person's name after the number", `${OWN}/tadeusz-rozpara`],
          ["a trailing slash", `${OWN}/`],
        ])(
          "writes the bare link over the same entry spelled with %s",
          async (_, spelled) => {
            table("nodes").rozpara!.rejestrIo = spelled;
            const result = await ingest(
              payload({
                name: "Tadeusz Rozpara",
                korytaId: "rozpara",
                rejestrIo: OWN,
              }),
            );
            expect(result.personId).toBe("rozpara");
            expect(await writtenPerson()).toMatchObject({ rejestrIo: OWN });
          },
        );

        it("still adopts a link onto a page that has none", async () => {
          delete table("nodes").rozpara!.rejestrIo;
          const result = await ingest(
            payload({
              name: "Tadeusz Rozpara",
              korytaId: "rozpara",
              rejestrIo: OWN,
            }),
          );
          expect(result.personId).toBe("rozpara");
          expect(await writtenPerson()).toMatchObject({ rejestrIo: OWN });
        });
      });
    });

    describe("somebody only an odpis names: the name and the birth date", () => {
      /** A payload for somebody with no rejestr.io entry: a name and the birth
       * date their PESEL gives, nothing else. */
      const payload = (body: Doc = {}) => ({
        name: "Anna Maria Nowak",
        birthDate: "1971-03-14",
        parties: [],
        companies: [],
        elections: [],
        ...body,
      });

      it("lands on the page of that name and birth date", async () => {
        table("nodes").anna = person({
          name: "Anna Maria Nowak",
          birthDate: "1971-03-14",
        });
        expect(await ingest(payload())).toMatchObject({
          personId: "anna",
          person: "unchanged",
        });
        expect(await all("revisions")).toEqual([]);
      });

      it("finds the page past its Polish letters and a middle name it lacks", async () => {
        Object.assign(table("nodes"), {
          anna: person({ name: "Anna Nowak", birthDate: "1971-03-14" }),
          ania: person({ name: "Ánna Nówak", birthDate: "1971-03-15" }),
        });
        expect(
          (await ingest(payload({ name: "Anna Maria Nowák" }))).personId,
        ).toBe("anna");
      });

      it("finds the page of a surname the index cuts at an apostrophe", async () => {
        table("nodes").kajetan = person({
          name: "Kajetan Ludwik D'obyrn",
          birthDate: "1971-03-14",
        });
        expect(
          (await ingest(payload({ name: "Kajetan Ludwik D'obyrn" }))).personId,
        ).toBe("kajetan");
      });

      it("lands on a linked page of that name and birth date", async () => {
        table("nodes").linked = person({
          name: "Anna Maria Nowak",
          birthDate: "1971-03-14",
          rejestrIo: "https://rejestr.io/osoby/5",
        });
        expect((await ingest(payload())).personId).toBe("linked");
      });

      it("opens a page of its own beside a namesake born on another day", async () => {
        table("nodes").other = person({
          name: "Anna Maria Nowak",
          birthDate: "1980-01-01",
        });
        const result = await ingest(payload());
        expect(result).toMatchObject({ person: "created" });
        expect(result.personId).not.toBe("other");
        const [revision] = await revisionsOf(result.personId);
        expect(revision!.data.data).toMatchObject({
          name: "Anna Maria Nowak",
          birthDate: "1971-03-14",
        });
        expect(revision!.data.data).not.toHaveProperty("rejestrIo");
      });

      it("does not take a namesake with another middle name for them", async () => {
        table("nodes").other = person({
          name: "Anna Ewa Nowak",
          birthDate: "1971-03-14",
        });
        expect((await ingest(payload())).person).toBe("created");
      });

      it("holds the person back where a page of the name stores no birth date", async () => {
        table("nodes").undated = person({ name: "Anna Nowak" });
        expect(await refusal(payload())).toMatchObject({
          statusCode: 409,
          message: expect.stringContaining("no birth date"),
        });
        expect(await all("revisions")).toEqual([]);
        expect((await all("nodes")).map((n) => n.id)).toEqual(["undated"]);
      });

      it("holds them back for an undated page writing their hyphen with a space", async () => {
        table("nodes").undated = person({ name: "Anna Nowak Rudnik" });
        expect(
          await refusal(payload({ name: "Anna Nowak-Rudnik" })),
        ).toMatchObject({
          statusCode: 409,
          message: expect.stringContaining("no birth date"),
        });
        expect(await all("revisions")).toEqual([]);
      });

      it.each(["Anna Nowak Rudnik", "Anna Nowak-Rudnik"])(
        "holds back the single surname for an undated %s alike",
        async (name) => {
          table("nodes").undated = person({ name });
          expect(await refusal(payload({ name: "Anna Rudnik" }))).toMatchObject(
            {
              statusCode: 409,
              message: expect.stringContaining("no birth date"),
            },
          );
          expect(await all("revisions")).toEqual([]);
        },
      );

      it("holds the person back where two pages share the name and the date", async () => {
        Object.assign(table("nodes"), {
          one: person({ name: "Anna Maria Nowak", birthDate: "1971-03-14" }),
          two: person({ name: "Anna Nowak", birthDate: "1971-03-14" }),
        });
        expect((await refusal(payload())).statusCode).toBe(409);
        expect(await all("revisions")).toEqual([]);
      });

      it("counts a merged page and its survivor as one page", async () => {
        Object.assign(table("nodes"), {
          tombstone: person({
            name: "Anna Maria Nowak",
            birthDate: "1971-03-14",
            merged_into: "survivor",
          }),
          survivor: person({ name: "Anna Nowak", birthDate: "1971-03-14" }),
        });
        expect((await ingest(payload())).personId).toBe("survivor");
      });

      it("leaves a page linking another entry to that entry's person", async () => {
        Object.assign(table("nodes"), {
          linked: person({
            name: "Anna Maria Nowak",
            birthDate: "1971-03-14",
            rejestrIo: "https://rejestr.io/osoby/5",
          }),
          undated: person({
            name: "Anna Nowak",
            rejestrIo: "https://rejestr.io/osoby/6",
          }),
        });
        const result = await ingest(
          payload({ rejestrIo: "https://rejestr.io/osoby/7" }),
        );
        expect(result.person).toBe("created");
        expect(["linked", "undated"]).not.toContain(result.personId);
      });

      it("adopts the entry onto an unlinked page of that name and date", async () => {
        table("nodes").anna = person({
          name: "Anna Maria Nowak",
          birthDate: "1971-03-14",
        });
        expect(
          await ingest(payload({ rejestrIo: "https://rejestr.io/osoby/7" })),
        ).toMatchObject({ personId: "anna", person: "updated" });
        const [revision] = await revisionsOf("anna");
        expect(revision!.data.data).toMatchObject({
          rejestrIo: "https://rejestr.io/osoby/7",
        });
      });

      it("holds the person back behind a linked page of the name with no birth date", async () => {
        table("nodes").linked = person({
          name: "Anna Nowak",
          rejestrIo: "https://rejestr.io/osoby/5",
        });
        expect((await refusal(payload())).statusCode).toBe(409);
      });

      it("still adopts an entry onto an unlinked page of its exact name with no date", async () => {
        table("nodes").stary = person({ name: "Anna Maria Nowak" });
        expect(
          await ingest(payload({ rejestrIo: "https://rejestr.io/osoby/7" })),
        ).toMatchObject({ personId: "stary", person: "updated" });
      });

      it("never puts an entry on a page of its name that stores another birth date", async () => {
        table("nodes").other = person({
          name: "Anna Maria Nowak",
          birthDate: "1980-01-01",
        });
        const result = await ingest(
          payload({ rejestrIo: "https://rejestr.io/osoby/7" }),
        );
        expect(result.person).toBe("created");
        expect(await revisionsOf("other")).toEqual([]);
      });

      it("never matches a company carrying the name", async () => {
        table("nodes").place = { type: "place", name: "Anna Maria Nowak" };
        const result = await ingest(payload());
        expect(result.person).toBe("created");
        expect(result.personId).not.toBe("place");
      });

      it("matches by the exact name alone with neither a date nor an entry, as before", async () => {
        table("nodes").linked = person({
          name: "Anna Maria Nowak",
          birthDate: "1980-01-01",
          rejestrIo: "https://rejestr.io/osoby/5",
        });
        expect((await ingest(payload({ birthDate: undefined }))).personId).toBe(
          "linked",
        );
      });
    });

    describe("jobs from the register entry a published page links", () => {
      const seat = {
        type: "employed",
        name: "Rada Nadzorcza",
        source: "zelewski",
        target: "kghm",
        start_date: "2026-02-09",
      };

      beforeEach(() => {
        as = "pipeline-people-import,datascience";
        Object.assign(table("nodes"), {
          zelewski: person({
            name: "Łukasz Żelewski",
            parties: ["PO"],
            rejestrIo: "https://rejestr.io/osoby/1398014",
            birthDate: "1962-12-08",
            published: true,
          }),
          arp: {
            type: "place",
            name: "AGENCJA ROZWOJU POMORZA",
            krsNumber: "0000004441",
            published: true,
          },
          kghm: {
            type: "place",
            name: "KGHM POLSKA MIEDŹ",
            krsNumber: "0000023302",
            published: true,
          },
        });
        table("edges")["arp-board"] = {
          type: "employed",
          name: "Zarząd",
          source: "zelewski",
          target: "arp",
          start_date: "2007-05-10",
          end_date: "2024-10-04",
          published: true,
          revision_id: "revisions/arp-board-approved",
        };
      });

      /** The 10-06 payload that added his KGHM seat, cut to two of its jobs:
       * one his page already showed, published by hand, and the new seat. */
      const payload = (overrides: Doc = {}) => ({
        name: "Łukasz Żelewski",
        rejestrIo: "https://rejestr.io/osoby/1398014",
        birthDate: "1962-12-08",
        parties: [],
        elections: [],
        companies: [
          {
            krs: "0000004441",
            role: "Zarząd",
            start: "2007-05-10",
            end: "2024-10-04",
          },
          { krs: "0000023302", role: "Rada Nadzorcza", start: "2026-02-09" },
        ],
        ...overrides,
      });

      /** The KGHM seat written as new, with its revision's status. */
      async function newSeat() {
        const [edge] = await sql<Row[]>`
        SELECT id, data FROM edges
        WHERE data->>'target' = 'kghm' AND id <> 'seat'`;
        if (!edge) return undefined;
        const revisions = await revisionsOf(edge.id);
        return {
          published: edge.data.published,
          status: revisions.map((r) => r.data.status),
        };
      }
      const live = { published: true, status: ["approved"] };
      const waiting = { published: false, status: ["pending"] };

      /** A KGHM seat stored and waiting for review, as the 10-06 run left it. */
      function waitingSeat(edge: Doc = {}, revision: Doc = {}) {
        table("edges").seat = { ...seat, published: false, ...edge };
        table("revisions").proposal = {
          node_id: "seat",
          collection: "edges",
          data: seat,
          status: "pending",
          update_user: "pipeline-people-import",
          update_automatic: true,
          update_time: "2026-10-06T06:22:31.053Z",
          ...revision,
        };
      }

      it("publishes a new job of a published person linked to the same entry", async () => {
        await ingest(payload());
        expect(await newSeat()).toEqual(live);
      });

      it("trusts a link adopted in the same request when the page already shows one of the entry's jobs", async () => {
        delete table("nodes").zelewski!.rejestrIo;
        await ingest(payload());
        expect(await newSeat()).toEqual(live);
      });

      it("leaves the job for a reviewer when the page shows none of the entry's jobs", async () => {
        delete table("nodes").zelewski!.rejestrIo;
        delete table("edges")["arp-board"];
        await ingest(payload());
        expect(await newSeat()).toEqual(waiting);
      });

      it("does not count a job the page holds but does not show", async () => {
        table("edges")["arp-board"]!.published = false;
        await ingest(payload());
        expect(await newSeat()).toEqual(waiting);
      });

      it("does not count a job at the same company that began on another day", async () => {
        table("edges")["arp-board"]!.start_date = "2008-01-01";
        await ingest(payload());
        expect(await newSeat()).toEqual(waiting);
      });

      it("never takes a payload from a register entry the page does not link", async () => {
        table("nodes").zelewski!.rejestrIo = "https://rejestr.io/osoby/1";
        expect(
          (await refusal(payload({ korytaId: "zelewski" }))).statusCode,
        ).toBe(409);
        expect(await newSeat()).toBeUndefined();
        expect(await all("revisions")).toEqual([]);
      });

      it("reads a link pasted from a browser as the entry it names", async () => {
        table("nodes").zelewski!.rejestrIo =
          "https://rejestr.io/osoby/1398014/lukasz-zelewski";
        await ingest(payload({ korytaId: "zelewski" }));
        expect(await newSeat()).toEqual(live);
      });

      it("leaves a draft's jobs for a reviewer", async () => {
        table("nodes").zelewski!.published = false;
        await ingest(payload());
        expect(await newSeat()).toEqual(waiting);
      });

      it("needs the payload to name its register entry", async () => {
        await ingest(payload({ rejestrIo: undefined }));
        expect(await newSeat()).toEqual(waiting);
      });

      it("leaves a job at a company in draft for whoever publishes the company", async () => {
        table("nodes").kghm!.published = false;
        await ingest(payload());
        expect(await newSeat()).toEqual(waiting);
      });

      it("publishes a stored job still waiting for its first review", async () => {
        waitingSeat();
        await ingest(payload());
        expect(await newSeat()).toBeUndefined();
        expect(await doc("revisions", "proposal")).toMatchObject({
          status: "approved",
          review_user: "pipeline-people-import",
        });
        expect(await doc("edges", "seat")).toMatchObject({
          published: true,
          revision_id: "revisions/proposal",
        });
        // The revision records who approved it; the audit log is for admins.
        expect(await all("audit")).toEqual([]);
      });

      it("leaves a stored job a reviewer rejected", async () => {
        waitingSeat({}, { status: "rejected", reject_reason: "inna osoba" });
        await ingest(payload());
        expect(await doc("edges", "seat")).toMatchObject({ published: false });
        expect((await doc("revisions", "proposal"))!.status).toBe("rejected");
        expect(await revisionsOf("seat")).toHaveLength(1);
      });

      it("leaves a stored job somebody approved and kept off the site", async () => {
        waitingSeat(
          { revision_id: "revisions/proposal" },
          { status: "approved" },
        );
        await ingest(payload());
        expect(await doc("edges", "seat")).toMatchObject({ published: false });
        expect(await revisionsOf("seat")).toHaveLength(1);
      });

      it("leaves a stored job a person wrote", async () => {
        waitingSeat({}, { update_automatic: false, update_user: "editor" });
        await ingest(payload());
        expect(await doc("edges", "seat")).toMatchObject({ published: false });
        expect((await doc("revisions", "proposal"))!.status).toBe("pending");
      });

      it("leaves the job when only an older revision says what it says", async () => {
        waitingSeat();
        table("revisions").later = {
          ...table("revisions").proposal,
          data: { ...seat, end_date: "2026-03-18" },
          update_time: "2026-10-07T06:22:31.053Z",
        };
        await ingest(payload());
        expect(await doc("edges", "seat")).toMatchObject({ published: false });
        expect((await doc("revisions", "proposal"))!.status).toBe("pending");
        expect((await doc("revisions", "later"))!.status).toBe("pending");
      });

      it("publishes only a revision that says what the stored job says", async () => {
        waitingSeat({}, { data: { ...seat, end_date: "2026-03-18" } });
        await ingest(payload());
        expect(await doc("edges", "seat")).toMatchObject({ published: false });
        expect((await doc("revisions", "proposal"))!.status).toBe("pending");
      });

      describe("a stored job the register has closed since", () => {
        /** The payload with both jobs, the KGHM seat ended on `end`, or open
         * for null. */
        const closedSeat = (end: string | null = "2026-08-25") =>
          payload({
            companies: [
              {
                krs: "0000004441",
                role: "Zarząd",
                start: "2007-05-10",
                end: "2024-10-04",
              },
              {
                krs: "0000023302",
                role: "Rada Nadzorcza",
                start: "2026-02-09",
                ...(end ? { end } : {}),
              },
            ],
          });

        /** The revisions this request wrote onto a stored edge. */
        async function writtenOnto(edgeId: string) {
          return (await revisionsOf(edgeId))
            .filter((r) => r.id !== "proposal")
            .map((r) => r.data);
        }

        it("writes the end onto a draft's job and leaves it waiting", async () => {
          table("nodes").zelewski!.published = false;
          waitingSeat();
          await ingest(closedSeat());
          const written = await writtenOnto("seat");
          expect(written).toHaveLength(1);
          expect(written[0]).toMatchObject({
            status: "pending",
            update_automatic: true,
          });
          expect(written[0]!.data).toEqual({ ...seat, end_date: "2026-08-25" });
          // On the stored spell, not beside it.
          expect(await newSeat()).toBeUndefined();
          expect((await doc("revisions", "proposal"))!.status).toBe("pending");
          expect(await doc("edges", "seat")).toMatchObject({
            published: false,
          });
        });

        it("approves the end of a live job with it", async () => {
          table("edges").seat = {
            ...seat,
            published: true,
            revision_id: "revisions/seat-approved",
          };
          await ingest(closedSeat());
          const [written] = await writtenOnto("seat");
          expect(written!.data).toEqual({ ...seat, end_date: "2026-08-25" });
          expect(written!.status).toBe("approved");
          expect(await doc("edges", "seat")).toMatchObject({
            end_date: "2026-08-25",
            published: true,
          });
        });

        it("puts a verified person's waiting job live with its end", async () => {
          waitingSeat();
          await ingest(closedSeat());
          expect((await doc("revisions", "proposal"))!.status).toBe("approved");
          const [written] = await writtenOnto("seat");
          expect(written!.data).toEqual({ ...seat, end_date: "2026-08-25" });
          expect(written!.status).toBe("approved");
          // The end goes on after the approval, so the end is what stays live.
          const [end] = (await revisionsOf("seat")).filter(
            (r) => r.id !== "proposal",
          );
          expect(await doc("edges", "seat")).toMatchObject({
            published: true,
            end_date: "2026-08-25",
            revision_id: `revisions/${end!.id}`,
          });
        });

        it("leaves an end already stored as it is, and says so", async () => {
          table("edges").seat = {
            ...seat,
            end_date: "2026-07-01",
            published: true,
          };
          const result = await ingest(closedSeat());
          expect(await writtenOnto("seat")).toEqual([]);
          expect(result.droppedChanges).toEqual([
            {
              edgeId: "seat",
              krs: "0000023302",
              field: "end_date",
              stored: "2026-07-01",
              sent: "2026-08-25",
              reason: "kept",
            },
          ]);
        });

        it("does not reopen a job the payload sends without an end, and says so", async () => {
          table("edges").seat = {
            ...seat,
            end_date: "2026-07-01",
            published: true,
          };
          const result = await ingest(closedSeat(null));
          expect(await writtenOnto("seat")).toEqual([]);
          expect(result.droppedChanges).toEqual([
            expect.objectContaining({
              edgeId: "seat",
              stored: "2026-07-01",
              sent: null,
              reason: "kept",
            }),
          ]);
        });

        it("leaves a removed job removed, and says so", async () => {
          table("edges").seat = { ...seat, deleted: true };
          const result = await ingest(closedSeat());
          expect(await writtenOnto("seat")).toEqual([]);
          expect((await doc("edges", "seat"))!.deleted).toBe(true);
          expect(result.droppedChanges).toEqual([
            expect.objectContaining({
              edgeId: "seat",
              krs: "0000023302",
              stored: null,
              sent: "2026-08-25",
              reason: "removed",
            }),
          ]);
        });

        it("reports nothing it wrote, nor a removed job restated as it is", async () => {
          table("edges").seat = { ...seat, published: true };
          table("edges").board = {
            type: "employed",
            name: "Zarząd",
            source: "zelewski",
            target: "arp",
            start_date: "2001-01-01",
            deleted: true,
          };
          const result = await ingest(
            payload({
              companies: [
                {
                  krs: "0000004441",
                  role: "Zarząd",
                  start: "2007-05-10",
                  end: "2024-10-04",
                },
                { krs: "0000004441", role: "Zarząd", start: "2001-01-01" },
                {
                  krs: "0000023302",
                  role: "Rada Nadzorcza",
                  start: "2026-02-09",
                  end: "2026-08-25",
                },
              ],
            }),
          );
          expect(await writtenOnto("seat")).toHaveLength(1);
          expect(result).not.toHaveProperty("droppedChanges");
        });

        it("writes nothing onto a job whose end it already holds", async () => {
          const result = await ingest(closedSeat());
          expect(await writtenOnto("arp-board")).toEqual([]);
          expect(result).not.toHaveProperty("droppedChanges");
        });
      });

      describe("what the answer says it did with each row", () => {
        const job = (result: Answer, krs: string) =>
          result.companies.find((row) => row.krs === krs);

        it("says it created the new seat and put it live, and neither of a job the page shows", async () => {
          const result = await ingest(payload());
          expect(job(result, "0000023302")).toMatchObject({
            created: true,
            published: true,
          });
          expect(job(result, "0000004441")).toMatchObject({
            created: false,
            published: false,
          });
        });

        it("says a new job it left for a reviewer was created and not put live", async () => {
          table("nodes").zelewski!.published = false;
          const result = await ingest(payload());
          expect(job(result, "0000023302")).toMatchObject({
            created: true,
            published: false,
          });
        });

        it("says a waiting job it approved went live, though it was not new", async () => {
          waitingSeat();
          const result = await ingest(payload());
          expect(job(result, "0000023302")).toEqual({
            nodeId: "kghm",
            krs: "0000023302",
            edgeId: "seat",
            created: false,
            published: true,
          });
        });

        it("says nothing went live for a waiting job it left waiting", async () => {
          waitingSeat({}, { status: "rejected", reject_reason: "inna osoba" });
          const result = await ingest(payload());
          expect(job(result, "0000023302")).toMatchObject({
            edgeId: "seat",
            created: false,
            published: false,
          });
        });

        it("keeps an article's created about the article, not the mention", async () => {
          table("nodes").article = {
            type: "article",
            name: "",
            sourceURL: "https://example.pl/a",
          };
          const result = await ingest(
            payload({
              sources: ["https://example.pl/a", "https://example.pl/b"],
            }),
          );
          expect(result.articles).toEqual([
            expect.objectContaining({ nodeId: "article", created: false }),
            expect.objectContaining({ created: true }),
          ]);
          expect(result.articles[1]!.nodeId).not.toBe("article");
          expect(
            await doc("nodes", String(result.articles[1]!.nodeId)),
          ).toMatchObject({
            type: "article",
            sourceURL: "https://example.pl/b",
          });
          expect(result.articles[0]).not.toHaveProperty("published");
        });
      });

      describe("a job at a company the site has no page for", () => {
        /** Every job the request wrote, as (company, role). */
        async function jobsWritten() {
          return (await all("revisions"))
            .map((r) => r.data.data as Doc)
            .filter((data) => data.type === "employed")
            .map((data) => [data.target, data.name]);
        }

        /** The payload, from an uploader that reads `unplacedEmployments`. */
        const reported = (overrides: Doc = {}) =>
          payload({ reportUnplacedEmployments: true, ...overrides });

        it("writes the rest of the person, and says which job it left out", async () => {
          delete table("nodes").kghm;
          const result = await ingest(reported({ parties: ["PSL"] }));
          expect(result).toMatchObject({ personId: "zelewski", status: "ok" });
          expect(result.person).toBe("updated");
          expect(result.companies).toEqual([
            expect.objectContaining({ nodeId: "arp", krs: "0000004441" }),
          ]);
          expect(result.unplacedEmployments).toEqual([
            {
              krs: "0000023302",
              role: "Rada Nadzorcza",
              start: "2026-02-09",
              reason: "no-company",
            },
          ]);
          expect(await jobsWritten()).toEqual([]);
          // What it did write was committed.
          expect((await doc("nodes", "zelewski"))!.parties).toEqual(
            expect.arrayContaining(["PO", "PSL"]),
          );
        });

        it("keeps every other job at its own company", async () => {
          delete table("nodes").arp;
          const result = await ingest(reported());
          expect(await jobsWritten()).toEqual([["kghm", "Rada Nadzorcza"]]);
          expect(result.companies).toEqual([
            expect.objectContaining({ nodeId: "kghm", krs: "0000023302" }),
          ]);
          expect(result.unplacedEmployments).toEqual([
            {
              krs: "0000004441",
              role: "Zarząd",
              start: "2007-05-10",
              end: "2024-10-04",
              reason: "no-company",
            },
          ]);
        });

        it("creates a new person whose every company has no page", async () => {
          delete table("nodes").arp;
          delete table("nodes").kghm;
          const result = await ingest(
            reported({
              name: "Anna Nowak",
              rejestrIo: "https://rejestr.io/osoby/1",
              birthDate: "1970-01-01",
            }),
          );
          expect(result.person).toBe("created");
          expect(result.companies).toEqual([]);
          expect(result.unplacedEmployments?.map((row) => row.krs)).toEqual([
            "0000004441",
            "0000023302",
          ]);
          expect(await doc("nodes", result.personId)).toMatchObject({
            name: "Anna Nowak",
          });
        });

        it("says nothing about jobs when every company has a page", async () => {
          expect(await ingest(reported())).not.toHaveProperty(
            "unplacedEmployments",
          );
        });

        it("refuses the whole person, as it did, an uploader that does not say it reads the report", async () => {
          delete table("nodes").kghm;
          const before = table("nodes").zelewski;
          const result = await ingest(payload());
          expect(result).toEqual({
            message: "Missing companies: 0000023302",
            data: ["0000023302"],
          });
          expect(await all("revisions")).toEqual([]);
          expect(await doc("nodes", "zelewski")).toEqual(before);
          expect((await all("edges")).map((e) => e.id)).toEqual(["arp-board"]);
        });
      });
    });
  },
);
