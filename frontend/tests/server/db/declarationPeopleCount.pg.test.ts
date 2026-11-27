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
import { PEOPLE_DOC } from "~~/server/utils/declarationPeople";
import { shardOf } from "~~/server/utils/declarationPeopleCount";
import {
  countDeclarationPeoplePg,
  refuseOlderFactsPg,
  restageDeclarationPeoplePg,
} from "~~/server/db/declarationPeopleCount";
import type { PersonEntry } from "~~/shared/declarationPeople";
import {
  declarationPeopleSchema,
  type DeclarationFact,
  type DeclarationFactsIngest,
  type DeclarationPeople,
} from "~~/shared/declarations";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { PathMirror } from "./pathMirror";

/**
 * The people count on Postgres: counted whole from the night's facts and
 * re-staged for the pages a daytime event touches. The cases of the
 * Firestore double this file replaces
 * (tests/server/utils/declarationPeopleCount.test.ts): the documents are
 * arranged by `collection/id`, written to their tables before each call and
 * read back after it (`PathMirror`). Which pages have a public post is the
 * site's own `pagesWithAPublicPostPg`, run for real.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationPeopleCount.pg.test.ts
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).createError = (err: any) =>
  Object.assign(new Error(err.message), err);

type Data = Record<string, unknown>;

let sql: postgres.Sql;
const mirror = new PathMirror(() => sql);
let stored = mirror.stored;
/** Tables the next call finds it cannot read. */
let unreadable: string[] = [];

const DECLARATION_PEOPLE = "declarationPeople";

const countDeclarationPeople = (body: DeclarationFactsIngest, now: Date) =>
  mirror.around(() => countDeclarationPeoplePg(body, now), { unreadable });
const refuseOlderFacts = (body: DeclarationFactsIngest) =>
  mirror.around(() => refuseOlderFactsPg(body), { unreadable });
const restageDeclarationPeople = (ids: string[], now: Date) =>
  mirror.around(() => restageDeclarationPeoplePg(ids, now), { unreadable });

/** An instant as the documents store it. */
const iso = (date: Date) => date.toISOString();

const NOW = new Date("2026-11-17T06:15:00.000Z");
const LATER = new Date("2026-11-18T09:30:00.000Z");

const K = {
  jan: "a1a1a1a1",
  gone: "b2b2b2b2",
  anna: "c3c3c3c3",
  public: "d4d4d4d4",
  ewa: "e5e5e5e5",
  piotr: "f6f6f6f6",
  ola: "a7a7a7a7",
  done: "b8b8b8b8",
};

function fact(
  key: string,
  page: string,
  over: Partial<DeclarationFact> = {},
): DeclarationFact {
  return {
    key,
    kids: [page],
    teryt: "021704",
    unitName: "Testowo (gmina wiejska)",
    year: 2024,
    status: "found",
    reason: "named",
    uncut: false,
    cutNamed: false,
    waiting: false,
    bearers: 30_000,
    ...over,
  };
}

function body(over: Partial<DeclarationFactsIngest> = {}) {
  return {
    generation: "2026-11-17T05:40:00.000Z",
    listAt: "2026-11-17T04:10:00.000Z",
    part: "gs://koryta-pl-sharedcache/jobs/bip_declarations/facts/date=2026-11-17/2026-11-17T051500Z.jsonl.gz",
    partAt: "2026-11-17T05:15:00.000Z",
    candidacies: [
      // The list was built before his page was merged.
      fact(K.jan, "jan-old"),
      fact(K.gone, "gone"),
      fact(K.anna, "anna"),
      fact(K.public, "public"),
      fact(K.ewa, "ewa", { cutNamed: true, waiting: true }),
      fact(K.piotr, "piotr", { cutNamed: true }),
      fact(K.ola, "ola", { status: "not_found", reason: "captcha" }),
      fact(K.done, "done"),
    ],
    ...over,
  } satisfies DeclarationFactsIngest;
}

const PAID = ["jan", "public", "ewa", "piotr", "ola", "done"];

function world() {
  stored.clear();
  for (const [path, data] of new Map<string, Data>([
    ["nodes/jan-old", { type: "person", merged_into: "jan" }],
    ["nodes/jan", { type: "person", birthDate: " 1970-05-05 " }],
    // Nothing at a public company on her page.
    ["nodes/anna", { type: "person" }],
    ["nodes/public", { type: "person", published: true }],
    ["nodes/ewa", { type: "person" }],
    ["nodes/piotr", { type: "person" }],
    ["nodes/ola", { type: "person" }],
    ["nodes/done", { type: "person", published: true }],
    ["nodes/spolka", { type: "place", isPublic: true }],
    ...PAID.map((page): [string, Data] => [
      `edges/${page}-job`,
      { type: "employed", source: page, target: "spolka", name: "Prezes" },
    ]),
    ["declarationPublications/jan", { personId: "jan", status: "queued" }],
    [
      "declarationPublications/done",
      {
        personId: "done",
        status: "published",
        // 00:30 in Warsaw on the 17th.
        publishedAt: iso(new Date("2026-11-16T23:30:00Z")),
      },
    ],
    // Settled before the merge: it names his page by the old id.
    [
      "declarationExtracts/x1",
      {
        status: "agreed",
        personIds: ["jan-old"],
        pageOutcomes: { "jan-old": "queued" },
        agreed: { value: "1970-05-05", kind: "date" },
        candidacyKeys: [K.jan],
      },
    ],
    // His name was read on another councillor's page.
    [
      "declarationExtracts/x2",
      { status: "open", personIds: ["kowalski"], candidacyKeys: [K.piotr] },
    ],
  ]))
    stored.set(path, data);
}

/** Every entry the shards hold, by page, each checked to be in its shard. */
function entries(): Record<string, PersonEntry> {
  const all: Record<string, PersonEntry> = {};
  for (let i = 0; i < 8; i++) {
    const shard = stored.get(`${DECLARATION_PEOPLE}/shard-${i}`)?.entries as
      Record<string, PersonEntry> | undefined;
    for (const [page, entry] of Object.entries(shard ?? {})) {
      expect(shardOf(page)).toBe(i);
      all[page] = entry;
    }
  }
  return all;
}

const stages = () =>
  Object.fromEntries(
    Object.entries(entries()).map(([page, entry]) => [
      page,
      [entry.stage, entry.detail],
    ]),
  );

const snapshotOf = () =>
  declarationPeopleSchema.parse(
    stored.get(`stats/${PEOPLE_DOC}`),
  ) as DeclarationPeople;

beforeAll(async () => {
  sql = await openTestDatabase("declaration_people_count");
}, 120_000);
afterAll(async () => {
  await closeTestDatabase(sql);
});

beforeEach(() => {
  vi.clearAllMocks();
  unreadable = [];
  stored = mirror.stored;
  world();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.runIf(PG_TEST_DATABASE_URL)("countDeclarationPeoplePg", () => {
  it("counts the list's people a declaration can publish, each in one stage", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await countDeclarationPeople(body(), NOW);

    expect(result).toEqual({
      status: "ok",
      people: 5,
      stages: {
        published: 1,
        namesakes: 0,
        mismatched: 0,
        held: 1,
        reading: 0,
        cropped: 1,
        downloaded: 0,
        searching: 2,
      },
      unknownReasons: { captcha: 1 },
    });
    // Gone, without a public post, and public some other way: left out.
    expect(stages()).toEqual({
      // His crop and his kid both name the page he was merged from.
      jan: ["held", "queued"],
      ewa: ["cropped", ""],
      piotr: ["searching", "other_page"],
      ola: ["searching", "pending"],
      done: ["published", ""],
    });
    expect(entries().jan).toEqual({
      stage: "held",
      detail: "queued",
      band: 4,
      publishedOn: null,
      unit: "021704",
      unitName: "Testowo (gmina wiejska)",
      keys: [K.jan],
      candidacies: [
        {
          key: K.jan,
          teryt: "021704",
          unitName: "Testowo (gmina wiejska)",
          year: 2024,
          status: "found",
          reason: "named",
          uncut: false,
          cutNamed: false,
          waiting: false,
        },
      ],
      at: NOW.getTime(),
    });
    expect(stored.get(`${DECLARATION_PEOPLE}/meta`)).toEqual({
      generation: "2026-11-17T05:40:00.000Z",
      listAt: "2026-11-17T04:10:00.000Z",
      part: body().part,
      partAt: "2026-11-17T05:15:00.000Z",
      countedAt: NOW.toISOString(),
      shards: 8,
    });
    expect(snapshotOf()).toMatchObject({
      at: NOW.toISOString(),
      exportDay: "2026-11-17",
      people: 5,
      publishedByDay: [{ day: "2026-11-17", count: 1 }],
    });
  });

  it("takes a crop that reached the site after predator's facts for the one they said waits", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    // Uploaded after the facts were written, and found unreadable since.
    stored.set("declarationExtracts/x4", {
      status: "unreadable",
      personIds: ["ewa"],
      candidacyKeys: [K.ewa],
      createdAt: iso(new Date("2026-11-17T05:30:00Z")),
    });

    await countDeclarationPeople(body(), NOW);

    expect(stages().ewa).toEqual(["searching", "unreadable"]);
    // One the site had when they were written is not the one they meant.
    stored.set("declarationExtracts/x4", {
      ...stored.get("declarationExtracts/x4")!,
      createdAt: iso(new Date("2026-11-17T05:00:00Z")),
    });
    await countDeclarationPeople(body(), NOW);
    expect(stages().ewa).toEqual(["cropped", ""]);
  });

  it("refuses facts older than the ones counted, unless forced", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    stored.set(`${DECLARATION_PEOPLE}/meta`, {
      generation: "2026-11-17T07:00:00.000Z",
    });

    await expect(refuseOlderFacts(body())).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(countDeclarationPeople(body(), NOW)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(stored.has(`stats/${PEOPLE_DOC}`)).toBe(false);

    await refuseOlderFacts(body({ force: true }));
    await countDeclarationPeople(body({ force: true }), NOW);
    expect(snapshotOf().people).toBe(5);
    // The same night sent again is counted again.
    await refuseOlderFacts(body({ generation: "2026-11-17T05:40:00.000Z" }));
  });

  it("stages again a person an event moved while it read", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const shard = shardOf("ewa");
    stored.set(`${DECLARATION_PEOPLE}/meta`, {
      generation: "2026-11-16T05:40:00.000Z",
    });
    stored.set(`${DECLARATION_PEOPLE}/shard-${shard}`, {
      entries: {
        ewa: {
          stage: "reading",
          detail: "",
          band: 4,
          publishedOn: null,
          unit: "021704",
          unitName: "",
          keys: [K.ewa],
          candidacies: [
            {
              key: K.ewa,
              teryt: "021704",
              unitName: "",
              year: 2024,
              status: "found",
              reason: "named",
              uncut: false,
              cutNamed: true,
              waiting: false,
            },
          ],
          // Staged after the count began to read.
          at: NOW.getTime() + 1,
        },
      },
    });

    await countDeclarationPeople(body(), NOW);

    // Staged again from the night's candidacies, after the count.
    expect(entries().ewa).toMatchObject({
      stage: "cropped",
      at: NOW.getTime() + 60_000,
    });
    expect(entries().jan!.at).toBe(NOW.getTime());
  });
});

describe.runIf(PG_TEST_DATABASE_URL)("restageDeclarationPeoplePg", () => {
  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await countDeclarationPeople(body(), NOW);
  });

  it("moves a page that went up to published, and the day's bar with it", async () => {
    stored.set("nodes/jan", { type: "person", published: true });
    stored.set("declarationPublications/jan", {
      personId: "jan",
      status: "published",
      publishedAt: iso(LATER),
    });

    await restageDeclarationPeople(["jan"], LATER);

    expect(entries().jan).toMatchObject({
      stage: "published",
      publishedOn: "2026-11-18",
      at: LATER.getTime(),
    });
    expect(snapshotOf()).toMatchObject({
      at: LATER.toISOString(),
      exportDay: "2026-11-18",
      people: 5,
      published: 2,
      held: 0,
      publishedByDay: [
        { day: "2026-11-17", count: 1 },
        { day: "2026-11-18", count: 1 },
      ],
    });
  });

  it("moves a person on as the crop predator said waits arrives and settles", async () => {
    stored.set("declarationExtracts/x4", {
      status: "open",
      personIds: ["ewa"],
      candidacyKeys: [K.ewa],
      createdAt: iso(new Date("2026-11-18T08:00:00Z")),
    });
    await restageDeclarationPeople(["ewa"], LATER);
    expect(stages().ewa).toEqual(["reading", ""]);

    stored.set("declarationExtracts/x4", {
      ...stored.get("declarationExtracts/x4")!,
      status: "unreadable",
    });
    await restageDeclarationPeople(["ewa"], LATER);

    // Not back to cropped: the crop the facts said waits is this one.
    expect(stages().ewa).toEqual(["searching", "unreadable"]);
    expect(snapshotOf()).toMatchObject({ cropped: 0, reading: 0 });
  });

  it("keeps a page a declaration published under an id merged into it since", async () => {
    stored.set("nodes/done-old", { type: "person", merged_into: "done" });
    stored.set("declarationPublications/done-old", {
      ...stored.get("declarationPublications/done")!,
      personId: "done-old",
    });
    stored.delete("declarationPublications/done");
    await countDeclarationPeople(body(), NOW);
    expect(entries().done).toMatchObject({ stage: "published" });

    await restageDeclarationPeople(["done"], LATER);

    expect(entries().done).toMatchObject({
      stage: "published",
      publishedOn: "2026-11-17",
    });
    expect(snapshotOf().people).toBe(5);
  });

  it("writes nothing while an entry does not read, as one a newer release wrote", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const page = ["zofia", "maria", "adam", "olga"].find(
      (id) => shardOf(id) !== shardOf("jan"),
    )!;
    const shard = `${DECLARATION_PEOPLE}/shard-${shardOf(page)}`;
    const held = entries().jan!;
    stored.set(shard, {
      entries: {
        ...(stored.get(shard)?.entries as Record<string, PersonEntry>),
        [page]: { ...held, stage: "queued" },
      },
    });
    stored.set("declarationPublications/jan", {
      personId: "jan",
      status: "published",
      publishedAt: iso(LATER),
    });
    const before = mirror.state();

    await restageDeclarationPeople(["jan"], LATER);

    expect(mirror.state()).toBe(before);
    expect(quiet).toHaveBeenCalledWith(
      expect.stringContaining("re-staging jan"),
      expect.objectContaining({
        message: expect.stringContaining("do not read"),
      }),
    );
  });

  it("drops a page made public some other way", async () => {
    stored.set("nodes/ewa", { type: "person", published: true });

    await restageDeclarationPeople(["ewa"], LATER);

    expect(entries().ewa).toBeUndefined();
    expect(snapshotOf()).toMatchObject({ people: 4, cropped: 0 });
  });

  it("follows a page merged since, and drops the one merged away", async () => {
    stored.set("nodes/ewa", { type: "person", merged_into: "ola" });
    stored.set("declarationExtracts/x3", {
      status: "open",
      personIds: ["ola"],
      candidacyKeys: [K.ola],
    });

    await restageDeclarationPeople(["ewa"], LATER);

    expect(stages()).toEqual({
      jan: ["held", "queued"],
      ola: ["reading", ""],
      piotr: ["searching", "other_page"],
      done: ["published", ""],
    });
  });

  it("leaves alone a page it does not count, and a newer staging", async () => {
    const before = mirror.state();
    await restageDeclarationPeople(["anna", "nobody"], LATER);
    expect(mirror.state()).toBe(before);

    // Staged from reads later than these.
    const shard = `${DECLARATION_PEOPLE}/shard-${shardOf("jan")}`;
    const held = stored.get(shard)!.entries as Record<string, PersonEntry>;
    held.jan = { ...held.jan!, at: LATER.getTime() + 1 };
    stored.set("declarationPublications/jan", {
      personId: "jan",
      status: "published",
      publishedAt: iso(LATER),
    });
    await restageDeclarationPeople(["jan"], LATER);
    expect(entries().jan!.stage).toBe("held");
  });

  it("never fails its caller", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    unreadable = ["nodes"];

    await expect(
      restageDeclarationPeople(["jan"], LATER),
    ).resolves.toBeUndefined();
    unreadable = [];
    expect(quiet).toHaveBeenCalledWith(
      expect.stringContaining("re-staging jan"),
      expect.any(Error),
    );
    expect(entries().jan!.stage).toBe("held");
  });
});
