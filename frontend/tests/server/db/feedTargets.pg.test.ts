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
  resetFeedTargetCache,
  resolveFeedTargets,
  type FeedTargetRef,
} from "~~/server/utils/feedTargets";
import * as feedDb from "~~/server/db/activityFeed";
import { collectionTables } from "~~/server/db/collections";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** The feed's targets named from Postgres (server/utils/feedTargets.ts over
 * server/db/activityFeed.ts).
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/feedTargets.pg.test.ts
 */

vi.mock("~~/server/db/activityFeed", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~~/server/db/activityFeed")>();
  return {
    ...actual,
    readFieldsPg: vi.fn(actual.readFieldsPg),
    newestRevisionsOfPg: vi.fn(actual.newestRevisionsOfPg),
  };
});

type Doc = Record<string, unknown>;
type Read = { collection: string; ids: string[]; fieldMask?: string[] };
type Query = { collection: string; wheres: unknown[][] };

let sql: postgres.Sql;
const spied = vi.mocked(feedDb);
const actual = await vi.importActual<
  typeof import("~~/server/db/activityFeed")
>("~~/server/db/activityFeed");

/** `seed` stored, every other table emptied; what the call then reads by id
 * is logged in `reads`, its lookups of a page's newest revision in
 * `queries`, and `failReads` makes a read throw. */
async function stored(
  seed: Record<string, Record<string, Doc>>,
  failReads?: (collection: string, ids: string[]) => boolean,
) {
  await sql.unsafe(`TRUNCATE ${Object.values(collectionTables).join(", ")}`);
  for (const [name, docs] of Object.entries(seed)) {
    const table = collectionTables[name as keyof typeof collectionTables];
    for (const [id, data] of Object.entries(docs)) {
      await sql`INSERT INTO ${sql(table)} (id, data) VALUES (${id}, ${sql.json(data as never)})`;
    }
  }
  const reads: Read[] = [];
  const queries: Query[] = [];
  spied.readFieldsPg.mockImplementation(async (collection, ids, fields) => {
    reads.push({ collection, ids: [...ids], fieldMask: [...fields] });
    if (failReads?.(collection, [...ids])) throw new Error("unavailable");
    return actual.readFieldsPg(collection, ids, fields);
  });
  spied.newestRevisionsOfPg.mockImplementation(async (ids, fields) => {
    for (const id of ids)
      queries.push({
        collection: "revisions",
        wheres: [["node_id", "==", id]],
      });
    return actual.newestRevisionsOfPg(ids, fields);
  });
  return { reads, queries };
}

const NODES = {
  p1: { name: "Jan Kowalski", type: "person" },
  p2: { name: "Anna Nowak", type: "person" },
  c1: { name: "PKP SA", type: "place" },
  gone: { name: "Usunięta Osoba", type: "person", deleted: true },
};

beforeEach(() => resetFeedTargetCache());
afterEach(() => vi.useRealTimers());

describe.runIf(PG_TEST_DATABASE_URL)("resolveFeedTargets on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("feed_targets");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });

  it("names a page and links it by its type", async () => {
    await stored({ nodes: NODES });

    const [person, place] = await resolveFeedTargets([
      { collection: "nodes", id: "p1" },
      { collection: "nodes", id: "c1" },
    ]);

    expect(person).toEqual({
      collection: "nodes",
      id: "p1",
      type: "person",
      name: "Jan Kowalski",
      href: "/osoba/jan-kowalski-p1",
    });
    expect(place?.href).toBe("/instytucja/pkp-sa-c1");
  });

  it("gives a removed page no link", async () => {
    await stored({ nodes: NODES });

    const [gone] = await resolveFeedTargets([
      { collection: "nodes", id: "gone" },
    ]);

    expect(gone).toMatchObject({ name: "Usunięta Osoba", href: null });
    expect(gone?.deleted).toBe(true);
  });

  it("follows merged_into to the page that survived, hop by hop", async () => {
    await stored({
      nodes: {
        ...NODES,
        dupA: {
          name: "J. Kowalski",
          type: "person",
          deleted: true,
          merged_into: "dupB",
        },
        dupB: {
          name: "Kowalski Jan",
          type: "person",
          deleted: true,
          merged_into: "p1",
        },
      },
    });

    const [target] = await resolveFeedTargets([
      { collection: "nodes", id: "dupA" },
    ]);

    expect(target).toMatchObject({
      id: "p1",
      name: "Jan Kowalski",
      href: "/osoba/jan-kowalski-p1",
    });
    expect(target?.deleted).toBeUndefined();
  });

  it("stops a merge cycle instead of hanging on it", async () => {
    await stored({
      nodes: {
        a: { name: "A", type: "person", merged_into: "b" },
        b: { name: "B", type: "person", merged_into: "a" },
      },
    });

    const [target] = await resolveFeedTargets([
      { collection: "nodes", id: "a" },
    ]);

    expect(target?.id).toBe("b");
  });

  it("stays on the last real page when merged_into points at nothing", async () => {
    await stored({
      nodes: { a: { name: "A", type: "person", merged_into: "missing" } },
    });

    const [target] = await resolveFeedTargets([
      { collection: "nodes", id: "a" },
    ]);

    expect(target?.id).toBe("a");
  });

  it("does not follow a page asked for exactly", async () => {
    await stored({
      nodes: { ...NODES, p2: { ...NODES.p2, merged_into: "p1" } },
    });

    const [target] = await resolveFeedTargets([
      { collection: "nodes", id: "p2", exact: true },
    ]);

    expect(target?.id).toBe("p2");
  });

  it("names a relation after its two ends and links it to its source", async () => {
    await stored({
      nodes: NODES,
      edges: { e1: { source: "p1", target: "c1", type: "employed" } },
    });

    const [edge] = await resolveFeedTargets([
      { collection: "edges", id: "e1" },
    ]);

    expect(edge).toEqual({
      collection: "edges",
      id: "e1",
      type: "edge",
      name: "Jan Kowalski → PKP SA",
      href: "/osoba/jan-kowalski-p1",
    });
  });

  it("names a relation by the ends its revision gives", async () => {
    // The stored edge has since been pointed elsewhere; the event is about
    // what the revision said.
    await stored({
      nodes: NODES,
      edges: { e1: { source: "p1", target: "c1", type: "employed" } },
    });

    const [edge] = await resolveFeedTargets([
      { collection: "edges", id: "e1", ends: { source: "p2", target: "c1" } },
    ]);

    expect(edge?.name).toBe("Anna Nowak → PKP SA");
  });

  it("gives a removed relation no link", async () => {
    await stored({
      nodes: NODES,
      edges: { e1: { source: "p1", target: "c1", deleted: true } },
    });

    const [edge] = await resolveFeedTargets([
      { collection: "edges", id: "e1" },
    ]);

    expect(edge).toMatchObject({ href: null, deleted: true });
  });

  it("drops a relation whose end cannot be named", async () => {
    await stored({
      nodes: NODES,
      edges: { e1: { source: "p1", target: "nowhere" } },
    });

    expect(
      await resolveFeedTargets([{ collection: "edges", id: "e1" }]),
    ).toEqual([null]);
  });

  it("names a fact after its person and organisation", async () => {
    await stored({
      extractions: {
        f1: {
          personNodeName: "Jan Kowalski",
          person: "J. Kowalski",
          organization: "PKP SA",
        },
        f2: { person: "Anna Nowak" },
        f3: { fact_type: "employment" },
      },
    });

    const facts = await resolveFeedTargets([
      { collection: "extractions", id: "f1" },
      { collection: "extractions", id: "f2" },
      { collection: "extractions", id: "f3" },
    ]);

    expect(facts.map((fact) => fact?.name)).toEqual([
      "Jan Kowalski · PKP SA",
      "Anna Nowak",
      "fakt",
    ]);
    expect(facts[0]).toMatchObject({
      type: "fact",
      href: "/ekstrakcje/kategoryzacja?fact=f1",
    });
  });

  it("encodes a fact id into its link", async () => {
    await stored({ extractions: { "a&b": { person: "X" } } });

    const [fact] = await resolveFeedTargets([
      { collection: "extractions", id: "a&b" },
    ]);

    expect(fact?.href).toBe("/ekstrakcje/kategoryzacja?fact=a%26b");
  });

  it("names a page that exists only as a proposal from its revision", async () => {
    const { queries } = await stored({ nodes: NODES });

    const [target] = await resolveFeedTargets([
      {
        collection: "nodes",
        id: "new1",
        proposed: { name: "Nowa Osoba", type: "person" },
      },
    ]);

    expect(target).toMatchObject({
      name: "Nowa Osoba",
      href: "/osoba/nowa-osoba-new1",
    });
    expect(queries).toEqual([]);
  });

  it("falls back to the newest revision of a page it has no node for", async () => {
    const { queries } = await stored({
      nodes: NODES,
      revisions: {
        r1: {
          node_id: "new1",
          update_time: "2026-09-01T00:00:00.000Z",
          data: { name: "Nowa Osoba", type: "person" },
        },
        // Older: not the one it is named after.
        r0: {
          node_id: "new1",
          update_time: "2026-08-01T00:00:00.000Z",
          data: { name: "Stara Nazwa", type: "person" },
        },
      },
    });

    const [target] = await resolveFeedTargets([
      { collection: "nodes", id: "new1" },
    ]);

    expect(target?.name).toBe("Nowa Osoba");
    expect(queries).toEqual([
      { collection: "revisions", wheres: [["node_id", "==", "new1"]] },
    ]);
  });

  it("drops a target that is neither a page nor a proposal", async () => {
    await stored({ nodes: NODES });

    expect(
      await resolveFeedTargets([{ collection: "nodes", id: "nothing" }]),
    ).toEqual([null]);
  });

  it("drops an id that cannot name a document without ever building a ref", async () => {
    const { reads } = await stored({ nodes: NODES });

    const resolved = await resolveFeedTargets([
      { collection: "nodes", id: "a/b" },
      { collection: "nodes", id: "__name__" },
      { collection: "extractions", id: ".." },
      { collection: "nodes", id: "p1" },
    ]);

    expect(resolved.map((target) => target?.id ?? null)).toEqual([
      null,
      null,
      null,
      "p1",
    ]);
    expect(reads.flatMap((read) => read.ids)).toEqual(["p1"]);
  });

  it("drops the targets of a read that failed and keeps the rest", async () => {
    await stored(
      { nodes: NODES, extractions: { f1: { person: "X" } } },
      (collection) => collection === "extractions",
    );

    const resolved = await resolveFeedTargets([
      { collection: "extractions", id: "f1" },
      { collection: "nodes", id: "p1" },
    ]);

    expect(resolved.map((target) => target?.id ?? null)).toEqual([null, "p1"]);
  });

  it("reads each target once, with a field mask, in chunks of 300", async () => {
    const nodes: Record<string, Doc> = {};
    const refs: FeedTargetRef[] = [];
    for (let i = 0; i < 301; i++) {
      nodes[`n${i}`] = { name: `Osoba ${i}`, type: "person" };
      refs.push(
        { collection: "nodes", id: `n${i}` },
        { collection: "nodes", id: `n${i}` },
      );
    }
    const { reads } = await stored({ nodes });

    const resolved = await resolveFeedTargets(refs);

    expect(resolved.every(Boolean)).toBe(true);
    expect(reads.map((read) => read.ids.length)).toEqual([300, 1]);
    expect(reads[0]?.fieldMask).toEqual([
      "name",
      "type",
      "merged_into",
      "deleted",
    ]);
  });

  it("remembers what it read for an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
    const { reads } = await stored({ nodes: NODES });
    const refs: FeedTargetRef[] = [{ collection: "nodes", id: "p1" }];

    await resolveFeedTargets(refs);
    vi.setSystemTime(new Date("2026-09-22T10:59:00Z"));
    await resolveFeedTargets(refs);
    expect(reads).toHaveLength(1);

    vi.setSystemTime(new Date("2026-09-22T11:01:00Z"));
    await resolveFeedTargets(refs);
    expect(reads).toHaveLength(2);

    resetFeedTargetCache();
    await resolveFeedTargets(refs);
    expect(reads).toHaveLength(3);
  });

  it("does not remember a read that failed", async () => {
    let failing = true;
    const { reads } = await stored({ nodes: NODES }, () => failing);
    const refs: FeedTargetRef[] = [{ collection: "nodes", id: "p1" }];

    expect(await resolveFeedTargets(refs)).toEqual([null]);
    failing = false;
    expect((await resolveFeedTargets(refs))[0]?.id).toBe("p1");
    expect(reads).toHaveLength(2);
  });
});
