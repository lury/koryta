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
import nodesGet, { NODE_PAGE_LIMIT } from "~~/server/api/nodes/index.get";
import {
  fetchEdgesClose,
  fetchNodes,
  fetchNodesByIds,
} from "~~/server/utils/fetch";
import { placeNamesFromDb } from "~~/server/db/nodes";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  type TestEvent,
} from "./pgHarness";

/** /api/nodes on Postgres alone: the whole-type list `fetchNodes` caches, and
 * the table's paged list with every filter in SQL (server/db/nodes.ts), over
 * one small graph of regions, companies and the people who work there.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/nodeList.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.defineCachedFunction = (fn: unknown) => fn;
  g.getRequestHeader = () => undefined;
  g.getValidatedQuery = async (
    event: { query?: unknown },
    parse: (q: unknown) => unknown,
  ) => parse(event.query ?? {});
});
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
  getValidatedQuery: async (event: TestEvent, parse: (q: unknown) => unknown) =>
    parse(event.query ?? {}),
  getRequestHeader: () => undefined,
}));
// A bearer header is a signed in reader; `latest` from one is honoured.
vi.mock("~~/server/utils/auth", () => ({
  getUser: async (event: TestEvent) => {
    if (!event.headers.authorization)
      throw Object.assign(new Error("401"), { statusCode: 401 });
    return { uid: "editor" };
  },
  getOptionalUser: async (event: TestEvent) =>
    event.headers.authorization ? { uid: "editor" } : null,
}));
vi.mock("~~/server/utils/handlers", () => ({
  editorFreshCachedEventHandler: (fn: unknown) => fn,
  wantsLatest: async (event: TestEvent) =>
    !!event.headers.authorization && event.query?.latest === "true",
}));
vi.mock("firebase-functions/logger", () => ({ logger: { warn: vi.fn() } }));

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

type Listed = {
  nodes: Record<string, Record<string, any>>;
  total?: number;
  matched?: Record<string, string[]>;
  matchedPlaces?: Record<string, string>;
};
const list = (query: Record<string, string | string[]>, signedIn = false) =>
  (nodesGet as (e: unknown) => Promise<Listed>)({
    query,
    headers: signedIn ? { authorization: "Bearer t" } : {},
    context: {},
  });
/** The ids a paged list of people answers with, sorted. */
const people = async (
  query: Record<string, string | string[]>,
  signedIn = true,
) =>
  Object.keys(
    (await list({ type: "person", limit: "100", ...query }, signedIn)).nodes,
  ).sort();

/** Regions of mazowieckie and małopolskie, companies seated in them, and
 * the people at those companies. */
function graph() {
  const region = (id: string, teryt: string, name: string) => {
    table("nodes")[id] = { type: "region", name, teryt, published: true };
  };
  region("teryt14", "14", "Województwo mazowieckie");
  region("teryt1425", "1425", "Radom");
  region("teryt1465", "1465", "Warszawa");
  region("teryt1465011", "1465011", "Śródmieście");
  region("teryt12", "12", "małopolskie");
  region("teryt1261", "1261", "Kraków");
  // Region hierarchy edges share the collection and must be ignored.
  table("edges")["h-14-1465"] = {
    type: "owns",
    source: "teryt14",
    target: "teryt1465",
  };

  const company = (
    id: string,
    seat: string,
    categories: string[],
    extra: Record<string, unknown> = {},
  ) => {
    table("nodes")[id] = {
      type: "place",
      name: id.toUpperCase(),
      categories,
      // A state company: a post there is one the current-post filter counts.
      isPublic: true,
      published: true,
      ...extra,
    };
    table("edges")[`seat-${id}`] = {
      type: "seat",
      source: seat,
      target: id,
      published: true,
    };
  };
  company("szpitalWarszawa", "teryt1465", ["szpitale"], {
    krsNumber: "0000000001",
  });
  company("szpitalRadom", "teryt1425", ["szpitale"]);
  company("wodociagiWarszawa", "teryt1465", ["wodociagi"], {
    krsNumber: "0000000002",
  });
  company("szpitalKrakow", "teryt1261", ["szpitale"]);
  company("przychodnia", "teryt1465", ["szpitale"]);
  // A seat an admin has taken off the graph: the document stays.
  table("edges")["seat-przychodnia"]!.deleted = true;

  const person = (
    id: string,
    at: string,
    {
      published = true,
      ended = false,
      edgePublished = true,
      parties = [] as string[],
    } = {},
  ) => {
    table("nodes")[id] = { type: "person", name: id, published, parties };
    table("edges")[`job-${id}`] = {
      type: "employed",
      source: id,
      target: at,
      start_date: "2020-01-01",
      ...(ended ? { end_date: "2021-01-01" } : {}),
      published: edgePublished,
    };
  };
  person("pW", "szpitalWarszawa", { parties: ["PiS"] });
  person("pR", "szpitalRadom", { ended: true, parties: ["PO"] });
  person("pWod", "wodociagiWarszawa");
  person("pK", "szpitalKrakow", { parties: ["PiS", "PO"] });
  person("pPrz", "przychodnia");
  person("dW", "szpitalWarszawa", { published: false, edgePublished: false });

  const run = (
    id: string,
    who: string,
    where: string,
    year: string,
    position: string,
    elected: boolean,
    published = true,
  ) => {
    table("edges")[id] = {
      type: "election",
      source: who,
      target: where,
      start_date: `${year}-01-01`,
      position,
      elected,
      published,
    };
  };
  run("run-pW", "pW", "teryt1465", "2024", "Rada miasta", true);
  run("run-pR", "pR", "teryt1425", "2024", "Rada miasta", false);
  // Unpublished: a draft relation, in the `all` scope only.
  run("run-pK", "pK", "teryt12", "2023", "Sejm", true, false);
}

async function load() {
  await store.sync(sql);
  await sql`SELECT refresh_node_stats()`;
}

describe.runIf(PG_TEST_DATABASE_URL)("/api/nodes on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("node_list");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
  });

  describe("fetchNodes", () => {
    beforeEach(() => {
      const p = (id: string, parties?: unknown, extra = {}) => {
        table("nodes")[id] = {
          type: "person",
          name: id,
          ...(parties === undefined ? {} : { parties }),
          ...extra,
        };
      };
      p("pis", ["PiS"]);
      p("po", ["PO", "Inne"]);
      p("none", []);
      p("unset");
      p("duplicate", ["PiS"], { deleted: true, merged_into: "pis" });
      table("nodes").place = { type: "place", name: "Spółka" };
    });
    const ids = async (options = {}) =>
      Object.keys(
        await fetchNodes("person", { bypassCache: true, ...options }),
      ).sort();

    it("fetches every node of the type when no filter is given", async () => {
      await store.sync(sql);
      expect(await ids()).toEqual(["none", "pis", "po", "unset"]);
    });

    it("leaves a page that was merged away out of the list", async () => {
      // The tombstone is still a document - that is what makes its url
      // resolve - but it is no entity any more.
      await store.sync(sql);
      expect(await ids()).not.toContain("duplicate");
    });

    it("filters by a single party", async () => {
      await store.sync(sql);
      expect(await ids({ personParties: "PiS" })).toEqual(["pis"]);
    });

    it("filters by several parties", async () => {
      await store.sync(sql);
      expect(await ids({ personParties: ["PiS", "PO"] })).toEqual([
        "pis",
        "po",
      ]);
    });

    it("filters by no party (__NONE__), a missing list counting as none", async () => {
      await store.sync(sql);
      expect(await ids({ personParties: ["__NONE__"] })).toEqual([
        "none",
        "unset",
      ]);
    });

    it("filters by parties and __NONE__ at once", async () => {
      await store.sync(sql);
      expect(await ids({ personParties: ["PiS", "__NONE__"] })).toEqual([
        "none",
        "pis",
        "unset",
      ]);
    });

    it("reads the legacy `party` parameter of the route as the parties", async () => {
      table("nodes").pis.published = true;
      await load();
      const { nodes } = await list({
        type: "person",
        party: "PiS",
        limit: "10",
      });
      expect(Object.keys(nodes)).toEqual(["pis"]);
    });
  });

  describe("the bounds of a list", () => {
    it("hands out regions and topics whole", async () => {
      table("nodes").r1 = {
        type: "region",
        name: "Radom",
        teryt: "1425",
        published: true,
      };
      table("nodes").t1 = { type: "topic", name: "Fuzje", published: true };
      await store.sync(sql);
      expect(Object.keys((await list({ type: "region" })).nodes)).toEqual([
        "r1",
      ]);
      expect(Object.keys((await list({ type: "topic" })).nodes)).toEqual([
        "t1",
      ]);
    });

    it("refuses the whole of a type that grows with the base", async () => {
      await store.sync(sql);
      for (const type of ["person", "place", "article"]) {
        await expect(list({ type })).rejects.toMatchObject({ statusCode: 400 });
      }
    });

    it("cuts a page, or a sort without one, to NODE_PAGE_LIMIT rows", async () => {
      for (let i = 0; i < NODE_PAGE_LIMIT + 3; i++) {
        table("nodes")[`p${String(i).padStart(3, "0")}`] = {
          type: "person",
          name: `Osoba ${i}`,
          published: true,
        };
      }
      await load();
      const page = await list({ type: "person", limit: "10000" });
      expect(Object.keys(page.nodes)).toHaveLength(NODE_PAGE_LIMIT);
      expect(page.total).toBe(NODE_PAGE_LIMIT + 3);
      const sorted = await list({ type: "person", sortBy: "name" });
      expect(Object.keys(sorted.nodes)).toHaveLength(NODE_PAGE_LIMIT);
    });
  });

  describe("who sees what", () => {
    beforeEach(graph);

    // The whole of a type is a region's or a topic's alone (the bounds above).
    const draftRegion = () => {
      table("nodes").teryt1499 = {
        type: "region",
        name: "Szkic",
        teryt: "1499",
      };
    };

    it("lists a logged out reader the published pages alone", async () => {
      draftRegion();
      await load();
      expect(Object.keys((await list({ type: "region" })).nodes)).not.toContain(
        "teryt1499",
      );
    });

    it("lists a logged out reader who types `latest` the same", async () => {
      draftRegion();
      await load();
      expect(
        Object.keys((await list({ type: "region", latest: "true" })).nodes),
      ).not.toContain("teryt1499");
    });

    it("lists a signed in reader every page, drafts included", async () => {
      draftRegion();
      await load();
      const { nodes } = await list({ type: "region", latest: "true" }, true);
      expect(Object.keys(nodes)).toContain("teryt1499");
      expect(nodes.teryt1425!.stats.edges).toHaveProperty("all");
    });

    it("does not tell a logged out reader where a page's drafts lead, only how many", async () => {
      await load();
      const signedIn = (await list({ type: "person", limit: "10" }, true)).nodes
        .pK!.stats.edges;
      const hidden =
        signedIn.all.targetNodeIds.length -
        signedIn.approved.targetNodeIds.length;
      expect(hidden).toBeGreaterThan(0);
      const edges = (await list({ type: "person", limit: "10" })).nodes.pK!
        .stats.edges;
      expect(edges).not.toHaveProperty("all");
      expect(edges.hiddenTargets).toBe(hidden);
    });

    it("does not tell them on a paginated page either", async () => {
      await load();
      const { nodes } = await list({ type: "person", limit: "10" });
      expect(nodes.pK!.stats.edges).not.toHaveProperty("all");
    });

    it("leaves a signed in reader's paginated page whole", async () => {
      await load();
      const { nodes } = await list({ type: "person", limit: "10" }, true);
      expect(nodes.pK!.stats.edges).toHaveProperty("all");
    });

    it("leaves a merged-away duplicate out of the rows, and keeps an ordinary draft", async () => {
      table("nodes").dupe = {
        type: "person",
        name: "pW",
        deleted: true,
        merged_into: "pW",
      };
      await load();
      const ids = await people({});
      expect(ids).not.toContain("dupe");
      expect(ids).toContain("dW");
    });

    it("answers `id` with that one page, as a row, and nobody for an id not there", async () => {
      await load();
      const one = await list({ type: "person", id: "pR", limit: "10" }, true);
      expect(Object.keys(one.nodes)).toEqual(["pR"]);
      expect(one.total).toBe(1);
      expect(one.nodes.pR).toMatchObject({ id: "pR", visibility: true });
      expect(
        await list({ type: "person", id: "nobody", limit: "10" }, true),
      ).toMatchObject({
        nodes: {},
        total: 0,
      });
    });

    it("answers `ids` with those pages", async () => {
      await load();
      expect(await people({ ids: ["pW", "pK", "nobody"] })).toEqual([
        "pK",
        "pW",
      ]);
    });
  });

  describe("the region filter", () => {
    beforeEach(graph);

    it("expands a województwo code to every region inside it", async () => {
      await load();
      // przychodnia's seat was removed, so nothing places its people.
      expect(await people({ teryt: "14" })).toEqual(["dW", "pR", "pW", "pWod"]);
    });

    it("keeps a powiat code exact, without the whole województwo", async () => {
      await load();
      expect(await people({ teryt: "1425" })).toEqual(["pR"]);
    });

    it("answers nobody for an unknown powiat, and for a województwo with no regions", async () => {
      await load();
      expect(
        await list({ type: "person", teryt: "1499", limit: "10" }, true),
      ).toEqual({
        nodes: {},
        total: 0,
      });
      expect(
        await list({ type: "person", teryt: "02", limit: "10" }, true),
      ).toEqual({
        nodes: {},
        total: 0,
      });
    });

    it("honours the currentlyEmployed scope with a województwo", async () => {
      await load();
      expect(
        await people({ teryt: "14", currentlyEmployed: "selected" }),
      ).toEqual(["dW", "pW", "pWod"]);
    });

    it("reads a logged out reader's regions off the published relations", async () => {
      await load();
      expect(await people({ teryt: "14" }, false)).toEqual([
        "pR",
        "pW",
        "pWod",
      ]);
    });
  });

  describe("the company filters", () => {
    beforeEach(graph);

    it("matches people at a company seated in the województwo, past the region tree and a removed seat", async () => {
      await load();
      expect(await people({ companyTeryt: "14" })).toEqual([
        "dW",
        "pR",
        "pW",
        "pWod",
      ]);
    });

    it("intersects a sector with the company's location", async () => {
      await load();
      expect(
        await people({ category: "szpitale", companyTeryt: "14" }),
      ).toEqual(["dW", "pR", "pW"]);
    });

    it("filters by place node id", async () => {
      await load();
      expect(await people({ place: "szpitalKrakow" })).toEqual(["pK"]);
    });

    it("unions place with KRS rather than intersecting them", async () => {
      await load();
      expect(
        await people({ place: "szpitalKrakow", krs: "0000000002" }),
      ).toEqual(["pK", "pWod"]);
    });

    it("intersects KRS with a sector, and answers nobody for an empty intersection", async () => {
      await load();
      expect(await people({ krs: "0000000001", category: "szpitale" })).toEqual(
        ["dW", "pW"],
      );
      expect(
        await list(
          {
            type: "person",
            krs: "0000000001",
            category: "wodociagi",
            limit: "10",
          },
          true,
        ),
      ).toEqual({
        nodes: {},
        total: 0,
      });
    });

    it("keeps the person's region filter apart from the company's", async () => {
      await load();
      expect(await people({ teryt: "1261", companyTeryt: "14" })).toEqual([]);
      expect(await people({ teryt: "14", companyTeryt: "1465" })).toEqual([
        "dW",
        "pW",
        "pWod",
      ]);
    });

    it("says which companies put each row on a page filtered by company, and their names", async () => {
      await load();
      const page = await list(
        { type: "person", limit: "10", place: "szpitalRadom" },
        true,
      );
      expect(page.matched).toEqual({ pR: ["szpitalRadom"] });
      expect(page.matchedPlaces).toEqual({ szpitalRadom: "SZPITALRADOM" });
    });

    it("gives the regions a region filter covers after the places", async () => {
      await load();
      const page = await list(
        { type: "person", limit: "10", place: "szpitalRadom", teryt: "1425" },
        true,
      );
      expect(page.matched).toEqual({ pR: ["szpitalRadom", "teryt1425"] });
    });

    it("reads a logged out reader's matches off the published relations", async () => {
      // dW's post is unpublished, so to a guest nothing ties them there.
      await load();
      const page = await list({
        type: "person",
        limit: "10",
        place: "szpitalWarszawa",
      });
      expect(page.matched).toEqual({ pW: ["szpitalWarszawa"] });
    });

    it("says nothing of matches where no company or region filter is set", async () => {
      await load();
      const page = await list({ type: "person", limit: "10" }, true);
      expect(page).not.toHaveProperty("matched");
      expect(page).not.toHaveProperty("matchedPlaces");
    });
  });

  describe("the tier and the elections", () => {
    beforeEach(graph);

    it("filters by the difficulty tier stored on the person", async () => {
      table("nodes").pW.stats = { queueTier: 2 };
      table("nodes").pR.stats = { queueTier: 1 };
      await load();
      expect(await people({ queueTier: "2" })).toEqual(["pW"]);
    });

    it("lists anybody in any of the elections asked", async () => {
      await load();
      expect(await people({ election: "local-2024" })).toEqual(["pR", "pW"]);
      expect(
        await people({ election: ["local-2024", "parliament-2023"] }),
      ).toEqual(["pK", "pR", "pW"]);
    });

    it("reads a logged out reader's elections off the published candidacies", async () => {
      await load();
      expect(
        await people({ election: ["local-2024", "parliament-2023"] }, false),
      ).toEqual(["pR", "pW"]);
    });

    it("asks for the result's own key, for each election", async () => {
      await load();
      expect(
        await people({ election: "local-2024", electionResult: "won" }),
      ).toEqual(["pW"]);
      expect(
        await people({ election: "local-2024", electionResult: "lost" }),
      ).toEqual(["pR"]);
    });

    it("means nothing without an election", async () => {
      await load();
      expect(await people({ electionResult: "won" })).toEqual(await people({}));
    });
  });

  describe("sorting, votes and dates", () => {
    beforeEach(graph);
    /** The ids of a paged list in the order served. */
    const ordered = async (query: Record<string, string>, signedIn = true) =>
      Object.keys(
        (await list({ type: "person", limit: "100", ...query }, signedIn))
          .nodes,
      );
    const vote = (id: string, value: number) => {
      table("votes")[`${id}_v`] = {
        nodeId: id,
        userUid: "volunteer",
        categoryVotes: { interesting: value },
        updatedAt: "2026-11-20T10:00:00.000Z",
      };
    };

    it("sorts by name either way, ties and the rest by id", async () => {
      await load();
      expect(await ordered({ sortBy: "name" })).toEqual([
        "dW",
        "pK",
        "pPrz",
        "pR",
        "pW",
        "pWod",
      ]);
      expect(await ordered({ sortBy: "name", sortDesc: "true" })).toEqual([
        "pWod",
        "pW",
        "pR",
        "pPrz",
        "pK",
        "dW",
      ]);
    });

    it("sorts by facts and by notes, the most first", async () => {
      table("extractions").f1 = { personNodeId: "pR" };
      table("extractions").f2 = { personNodeId: "pR" };
      table("extractions").f3 = { personNodeId: "pK" };
      table("notes").n1 = {
        nodeId: "pWod",
        userUid: "u",
        sources: [{ url: "a" }, { url: "b" }],
      };
      await load();
      expect(
        (await ordered({ sortBy: "factsCount", sortDesc: "true" })).slice(0, 2),
      ).toEqual(["pR", "pK"]);
      expect(
        (await ordered({ sortBy: "notesCount", sortDesc: "true" }))[0],
      ).toBe("pWod");
    });

    it("sorts by the score, by visibility and by the latest post", async () => {
      vote("pK", 5);
      vote("pW", 2);
      table("edges")["job-pK"]!.start_date = "2023-05-01";
      await load();
      expect(
        (
          await ordered({ sortBy: "votes.interesting", sortDesc: "true" })
        ).slice(0, 2),
      ).toEqual(["pK", "pW"]);
      expect((await ordered({ sortBy: "visibility" }))[0]).toBe("dW");
      expect(
        (
          await ordered({ sortBy: "latestEmploymentStart", sortDesc: "true" })
        )[0],
      ).toBe("pK");
    });

    it("keeps only the people with a post since a date, and with a score", async () => {
      table("edges")["job-pK"]!.start_date = "2023-05-01";
      vote("pW", 2);
      await load();
      expect(await people({ minEmploymentDate: "2023-01-01" })).toEqual(["pK"]);
      expect(await people({ minVotes: "1" })).toEqual(["pW"]);
    });

    it("hides or keeps the people somebody voted on", async () => {
      vote("pW", 1);
      await load();
      expect(await people({ hideVoted: "has_votes" })).toEqual(["pW"]);
      expect(await people({ hideVoted: "no_votes" })).not.toContain("pW");
    });

    it("lists drafts and published pages apart, and no drafts to a guest", async () => {
      await load();
      expect(await people({ visibility: "private" })).toEqual(["dW"]);
      expect(await people({ visibility: "public" })).not.toContain("dW");
      expect(
        await list({ type: "person", visibility: "private", limit: "10" }),
      ).toEqual({ nodes: {}, total: 0 });
    });

    it("pages through the list, counting what it is cut from", async () => {
      await load();
      const page = await list(
        { type: "person", sortBy: "name", limit: "2", page: "2" },
        true,
      );
      expect(Object.keys(page.nodes)).toEqual(["pPrz", "pR"]);
      expect(page.total).toBe(6);
    });
  });

  describe("the other fetchers", () => {
    beforeEach(graph);

    it("fetchEdgesClose: the edges at either end of one id or many, each once", async () => {
      await load();
      const ids = (edges: { id: string }[]) => edges.map((e) => e.id).sort();
      expect(ids(await fetchEdgesClose("szpitalRadom"))).toEqual([
        "job-pR",
        "seat-szpitalRadom",
      ]);
      expect(ids(await fetchEdgesClose(["pW", "szpitalWarszawa"]))).toEqual([
        "job-dW",
        "job-pW",
        "run-pW",
        "seat-szpitalWarszawa",
      ]);
      expect(await fetchEdgesClose([])).toEqual([]);
    });

    it("fetchEdgesClose dates a candidacy on its election's day", async () => {
      await load();
      const [run] = (await fetchEdgesClose("pW")).filter(
        (e) => e.id === "run-pW",
      );
      expect(run).toMatchObject({
        start_date: expect.stringMatching(/^2024-/),
        visibility: true,
      });
      expect(run!.end_date).toBe(run!.start_date);
    });

    it("fetchNodesByIds: the documents asked for, missing ids dropped", async () => {
      await load();
      const rows = await fetchNodesByIds(["pK", "no-such-node", "pW", "pK"]);
      expect(rows.map((r) => r.id).sort()).toEqual(["pK", "pW"]);
      expect(await fetchNodesByIds([])).toEqual([]);
    });

    it("fetchNodes(region): every region, by id", async () => {
      await load();
      expect(
        Object.keys(await fetchNodes("region", { bypassCache: true })),
      ).toEqual([
        "teryt12",
        "teryt1261",
        "teryt14",
        "teryt1425",
        "teryt1465",
        "teryt1465011",
      ]);
    });
  });

  describe("placeNamesFromDb", () => {
    beforeEach(() => {
      table("nodes").a = { type: "place", name: "Alfa", published: true };
      table("nodes").b = { type: "place", name: "Beta" };
      table("nodes").m = {
        type: "place",
        name: "Gone",
        published: true,
        deleted: true,
        merged_into: "a",
      };
      table("nodes").p = { type: "person", name: "Osoba", published: true };
    });

    it("names the places, each once, and skips what is not a place", async () => {
      await store.sync(sql);
      expect(await placeNamesFromDb(["a", "a", "p", "teryt14"], true)).toEqual({
        a: "Alfa",
      });
    });

    it("reads nothing when the page names only regions", async () => {
      expect(await placeNamesFromDb(["teryt14", "teryt1465"], true)).toEqual(
        {},
      );
    });

    it("names a draft only to a reader who may see drafts, and a merged page to nobody", async () => {
      await store.sync(sql);
      expect(await placeNamesFromDb(["a", "b", "m"], true)).toEqual({
        a: "Alfa",
        b: "Beta",
      });
      expect(await placeNamesFromDb(["a", "b", "m"], false)).toEqual({
        a: "Alfa",
      });
    });
  });
});
