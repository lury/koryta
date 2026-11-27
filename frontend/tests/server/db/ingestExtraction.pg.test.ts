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
import handler from "~~/server/api/ingest/extraction.post";
import { insertFactsPg, peopleByIdPg } from "~~/server/db/extractionIngest";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** POST /api/ingest/extraction on Postgres: who may send facts, what a fact
 * is matched to, and the recount of the people a batch names.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/ingestExtraction.pg.test.ts
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

// Counted, to tell one read of the batch's people from one per article.
vi.mock("~~/server/db/extractionIngest", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~~/server/db/extractionIngest")>();
  return { ...actual, peopleByIdPg: vi.fn(actual.peopleByIdPg) };
});

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

type Fact = Record<string, unknown>;

const PIPELINE = "pipeline,datascience";

function batch(
  facts: Fact[],
  extra: Record<string, unknown> = {},
  url = "example.com/a",
) {
  return {
    articles: [
      {
        url,
        domain: "example.com",
        title: null,
        publication_date: null,
        tag: "v26",
        extracted_facts: facts.map((fact) => ({
          url,
          justification: "bo tak",
          fact_type: "employment",
          organization: "Orlen",
          ...fact,
        })),
        ...extra,
      },
    ],
  };
}

async function ingest(body: unknown, as: string | null = PIPELINE) {
  await store.sync(sql);
  return callAs<{ status: string; count: number; peopleUpdated: number }>(
    handler,
    as ?? undefined,
    { body },
  );
}

/** The stored facts, by the person they name. */
async function facts(): Promise<Map<string, Fact>> {
  const rows = await sql<{ data: Fact }[]>`SELECT data FROM extractions`;
  return new Map(rows.map(({ data }) => [String(data.person), data]));
}

const person = (name: string) => ({ type: "person", name, published: true });

describe.runIf(PG_TEST_DATABASE_URL)("POST /api/ingest/extraction", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("ingest_extraction");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    vi.mocked(peopleByIdPg).mockClear();
  });

  it("takes facts from the datascience group only", async () => {
    const body = batch([{ person: "Jan Kowalski" }]);
    expect(await statusOf(ingest(body, null))).toBe(401);
    expect(await statusOf(ingest(body, "reader"))).toBe(403);
    expect(await statusOf(ingest(body, "reader,admin"))).toBe(403);
    expect((await facts()).size).toBe(0);
    expect(await statusOf(ingest({ articles: [{ url: 1 }] }))).toBe(400);
  });

  it("stores each fact with its article, an unvoted aggregate and its time", async () => {
    const before = Date.now();
    expect(
      await ingest(
        batch([
          { person: "Jan Kowalski" },
          {
            person: "Zbigniew Ziobro",
            fact_type: "affair_involvement",
            organization: undefined,
            role: "kierujący zorganizowaną grupą przestępczą",
            affair: "Fundusz Sprawiedliwości",
          },
        ]),
      ),
    ).toEqual({ status: "ok", count: 2, peopleUpdated: 0 });
    const stored = await facts();
    const kowalski = stored.get("Jan Kowalski")!;
    expect(kowalski).toMatchObject({
      url: "example.com/a",
      articleUrl: "example.com/a",
      articleDomain: "example.com",
      tag: "v26",
      justification_in_text: null,
      uploaderUid: "pipeline",
      stats: { votes: { humanVoted: false } },
    });
    expect(Date.parse(kowalski.createdAt as string)).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(stored.get("Zbigniew Ziobro")).toMatchObject({
      fact_type: "affair_involvement",
      role: "kierujący zorganizowaną grupą przestępczą",
      affair: "Fundusz Sprawiedliwości",
    });
    expect(stored.get("Zbigniew Ziobro")).not.toHaveProperty("organization");
  });

  it("links a fact to its article node across url spellings", async () => {
    table("nodes")["article-node"] = {
      type: "article",
      name: "A",
      sourceURL: "https://www.example.com/a/",
    };
    await ingest(batch([{ person: "Jan Kowalski" }]));
    expect((await facts()).get("Jan Kowalski")?.articleNodeId).toBe(
      "article-node",
    );
  });

  it("credits the capture's uploader rather than the calling service", async () => {
    await ingest({
      ...batch([{ person: "Jan Kowalski" }]),
      uploaderUid: "reader-who-captured-it",
    });
    expect((await facts()).get("Jan Kowalski")?.uploaderUid).toBe(
      "reader-who-captured-it",
    );
  });

  describe("koryta_ids", () => {
    it("links each fact to the confirmed person its subject names", async () => {
      Object.assign(table("nodes"), {
        "gajda-id": person("Piotr Gajda"),
        "kozlowski-id": person("Krzysztof Kozłowski"),
        "barzowski-id": person("Jerzy Barzowski"),
      });
      await ingest(
        batch(
          [
            { person: "Piotr Gajda", fact_type: "party_membership" },
            { person: "Krzysztof Kozlowski" },
            { person: "Anna Nowak" },
            {
              fact_type: "personal_relation",
              person: undefined,
              subject: "Jerzy Barzowski",
              object: "Anna Nowak",
              relation: "brat",
            },
          ],
          { koryta_ids: ["gajda-id", "kozlowski-id", "barzowski-id"] },
        ),
      );
      const stored = await facts();
      expect(stored.get("Piotr Gajda")).toMatchObject({
        personNodeId: "gajda-id",
        personNodeName: "Piotr Gajda",
      });
      expect(stored.get("Krzysztof Kozlowski")).toMatchObject({
        personNodeId: "kozlowski-id",
        personNodeName: "Krzysztof Kozłowski",
      });
      expect(stored.get("Anna Nowak")).not.toHaveProperty("personNodeId");
      expect(stored.get("undefined")).toMatchObject({
        subject: "Jerzy Barzowski",
        personNodeId: "barzowski-id",
      });
    });

    it("links a short name to the page with the middle one, and asserts nothing on a shared name", async () => {
      Object.assign(table("nodes"), {
        "sikon-id": person("Antoni Ignacy Sikoń"),
        "kowalski-a": person("Jan Kowalski"),
        "kowalski-b": person("Jan Maria Kowalski"),
        "orlen-id": { type: "place", name: "Adam Nowak" },
      });
      await ingest(
        batch(
          [
            { person: "Antoni Sikoń" },
            { person: "Jan Kowalski" },
            { person: "Jan Maria Kowalski" },
            { person: "Adam Nowak" },
          ],
          {
            koryta_ids: [
              "sikon-id",
              "kowalski-a",
              "kowalski-b",
              "orlen-id",
              "missing-id",
            ],
          },
        ),
      );
      const stored = await facts();
      expect(stored.get("Antoni Sikoń")?.personNodeId).toBe("sikon-id");
      expect(stored.get("Jan Kowalski")).not.toHaveProperty("personNodeId");
      expect(stored.get("Jan Maria Kowalski")?.personNodeId).toBe("kowalski-b");
      expect(stored.get("Adam Nowak")).not.toHaveProperty("personNodeId");
    });

    it("asserts nothing when two confirmed people share a name", async () => {
      Object.assign(table("nodes"), {
        "kowalski-a": person("Jan Kowalski"),
        "kowalski-b": person("Jan Kowalski"),
      });
      await ingest(
        batch([{ person: "Jan Kowalski" }], {
          koryta_ids: ["kowalski-a", "kowalski-b"],
        }),
      );
      expect((await facts()).get("Jan Kowalski")).not.toHaveProperty(
        "personNodeId",
      );
    });

    it("links a fact that leaves out the middle name the page carries", async () => {
      Object.assign(table("nodes"), {
        "sikon-id": person("Antoni Ignacy Sikoń"),
        "wach-id": person("Urszula Lucyna Wach Górny"),
      });
      await ingest(
        batch([{ person: "Antoni Sikoń" }, { person: "Urszula Wach-Górny" }], {
          koryta_ids: ["sikon-id", "wach-id"],
        }),
      );
      const stored = await facts();
      expect(stored.get("Antoni Sikoń")).toMatchObject({
        personNodeId: "sikon-id",
        personNodeName: "Antoni Ignacy Sikoń",
      });
      expect(stored.get("Urszula Wach-Górny")?.personNodeId).toBe("wach-id");
    });

    it("reads each confirmed person once for the whole batch", async () => {
      table("nodes")["holownia-id"] = person("Szymon Hołownia");
      const article = (url: string) =>
        batch(
          [{ person: "Szymon Hołownia" }],
          {
            koryta_ids: ["holownia-id"],
          },
          url,
        ).articles[0]!;
      expect(
        await ingest({
          articles: [article("wpolityce.pl/a"), article("wpolityce.pl/b")],
        }),
      ).toMatchObject({ count: 2, peopleUpdated: 1 });
      expect(peopleByIdPg).toHaveBeenCalledTimes(1);
      expect(peopleByIdPg).toHaveBeenCalledWith(["holownia-id", "holownia-id"]);
      const rows = await sql<{ data: Fact }[]>`SELECT data FROM extractions`;
      expect(rows.map((r) => r.data.personNodeId)).toEqual([
        "holownia-id",
        "holownia-id",
      ]);
    });

    it("does not look anybody up when no article carries ids", async () => {
      table("nodes")["kowalski-id"] = person("Jan Kowalski");
      await ingest(batch([{ person: "Jan Kowalski" }], { tag: "capture_v1" }));
      // Asked for nobody, which answers without a query.
      expect(peopleByIdPg).toHaveBeenCalledWith([]);
      expect((await facts()).get("Jan Kowalski")).not.toHaveProperty(
        "personNodeId",
      );
    });
  });

  describe("stats.factsCount", () => {
    it("writes the recount, not an increment, onto every person the batch named", async () => {
      table("nodes")["gajda-id"] = {
        ...person("Piotr Gajda"),
        stats: { factsCount: 40, nodeGroupSize: 3 },
      };
      table("extractions").earlier = {
        fact_type: "employment",
        articleUrl: "example.com/old",
        personNodeId: "gajda-id",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const body = batch(
        [{ person: "Piotr Gajda" }, { person: "Piotr Gajda" }],
        {
          koryta_ids: ["gajda-id"],
        },
      );
      expect(await ingest(body)).toEqual({
        status: "ok",
        count: 2,
        peopleUpdated: 1,
      });
      const [node] = await sql<{ data: { stats: Record<string, number> } }[]>`
        SELECT data FROM nodes WHERE id = 'gajda-id'`;
      expect(node!.data.stats).toMatchObject({
        factsCount: 3,
        nodeGroupSize: 3,
      });
    });

    it("touches nobody when no fact was matched to a person", async () => {
      expect(await ingest(batch([{ person: "Piotr Gajda" }]))).toEqual({
        status: "ok",
        count: 1,
        peopleUpdated: 0,
      });
    });
    it("still reports success when the counter cannot be written", async () => {
      // A person gone by the time of the write: the facts are kept and
      // nobody is counted, rather than the batch failing and being resent.
      await store.sync(sql);
      expect(
        await insertFactsPg([
          {
            url: "example.com/a",
            justification: "bo tak",
            justification_in_text: null,
            fact_type: "employment",
            articleUrl: "example.com/a",
            articleDomain: "example.com",
            tag: "v26",
            createdAt: new Date().toISOString(),
            uploaderUid: "pipeline",
            stats: { votes: { humanVoted: false } },
            person: "Piotr Gajda",
            organization: "Orlen",
            personNodeId: "gone",
            personNodeName: "Piotr Gajda",
          },
        ]),
      ).toBe(0);
      expect((await facts()).get("Piotr Gajda")).toMatchObject({
        personNodeId: "gone",
      });
    });
  });
});
