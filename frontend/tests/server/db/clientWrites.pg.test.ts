import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { migrate } from "~~/server/db/migrate";
import { closeDb } from "~~/server/db/client";
import putVote from "~~/server/api/votes/[target].put";
import deleteVote from "~~/server/api/votes/[target].delete";
import mineVotes from "~~/server/api/votes/mine.get";
import pipelineGet from "~~/server/api/votes/pipeline.get";
import pipelinePost from "~~/server/api/votes/pipeline.post";
import notesGet from "~~/server/api/notes/index.get";
import putNote from "~~/server/api/notes/[nodeId].put";
import deleteNote from "~~/server/api/notes/[nodeId].delete";
import attachArticles from "~~/server/api/notes/[nodeId]/articles.post";
import meGet from "~~/server/api/me/index.get";
import mePatch from "~~/server/api/me/index.patch";
import qaGet from "~~/server/api/qa/checks/index.get";
import qaPut from "~~/server/api/qa/checks/[itemId].put";
import { normalizeUrl } from "~~/shared/url";

/** What firestore.rules enforced on the collections the browser wrote,
 * checked as the API's behaviour on Postgres: one test per rule. Needs a
 * database of its own, which it wipes:
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/clientWrites.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
});

type Event = {
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
  headers: Record<string, string>;
};

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    createError: (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts),
    defineEventHandler: (fn: unknown) => fn,
    getRouterParam: (event: Event, name: string) => event.params?.[name],
    readValidatedBody: async (event: Event, parse: (b: unknown) => unknown) =>
      parse(event.body),
    getValidatedQuery: async (event: Event, parse: (q: unknown) => unknown) =>
      parse(event.query ?? {}),
    setResponseHeader: () => {},
  };
});

/** `authorization: <uid>[,claim...]`: the token's uid and claims. */
vi.mock("~~/server/utils/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/utils/auth")>();
  const decode = (event: Event) => {
    const header = event.headers.authorization;
    if (!header) return null;
    const [uid, ...claims] = header.split(",");
    return { uid, ...Object.fromEntries(claims.map((c) => [c, true])) };
  };
  return {
    ...actual,
    getOptionalUser: async (event: Event) => decode(event),
    getUser: async (event: Event) => {
      const user = decode(event);
      if (!user) throw Object.assign(new Error("401"), { statusCode: 401 });
      return user;
    },
  };
});

const DATABASE_URL = process.env.PG_TEST_DATABASE_URL;
type Handler = (event: Event) => Promise<Record<string, unknown>>;
const call = (handler: unknown, event: Partial<Event> & { as?: string }) =>
  (handler as Handler)({
    headers: event.as ? { authorization: event.as } : {},
    ...event,
  });
const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (error) {
    const e = error as { statusCode?: number; name?: string };
    // zod's parse failing is h3's 400.
    return e.statusCode ?? (e.name === "ZodError" ? 400 : 500);
  }
};

let sql: postgres.Sql;

describe.runIf(DATABASE_URL)("client writes on Postgres", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    sql = postgres(DATABASE_URL!, { max: 2, onnotice: () => {} });
    await sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await sql`DROP SCHEMA IF EXISTS ops CASCADE`;
    await sql`CREATE SCHEMA public`;
    await migrate(sql);
  }, 120_000);

  beforeEach(async () => {
    await sql`TRUNCATE votes, notes, users, qa_checks, nodes, extractions`;
    await sql`INSERT INTO nodes (id, data) VALUES
      ('person1', ${sql.json({ type: "person", name: "Anna Nowak", published: true })}),
      ('place1', ${sql.json({ type: "place", name: "Wodociągi", published: true })})`;
    await sql`INSERT INTO extractions (id, data) VALUES
      ('ex1', ${sql.json({ fact_type: "employment", articleUrl: "u", tag: "t" })})`;
  });

  afterAll(async () => {
    await sql.end();
    await closeDb();
  });

  const vote = (as: string | undefined, target: string, body: unknown) =>
    call(putVote, { as, params: { target }, body });
  const stored = async (id: string) =>
    (
      await sql<{ data: Record<string, unknown> }[]>`
      SELECT data FROM votes WHERE id = ${id}`
    )[0]?.data;

  describe("votes", () => {
    it("refuses a reader who is not signed in", async () => {
      expect(await status(vote(undefined, "person1", {}))).toBe(401);
    });

    it("files the vote under the token's uid, never the body's", async () => {
      await vote("alice", "person1", {
        categoryVotes: { interesting: 2 },
        userUid: "bob",
      });
      expect(await stored("person1_bob")).toBeUndefined();
      expect(await stored("person1_alice")).toMatchObject({
        nodeId: "person1",
        userUid: "alice",
        categoryVotes: { interesting: 2 },
      });
    });

    it("keeps one document per target per person, merging categories", async () => {
      await vote("alice", "person1", { categoryVotes: { interesting: 2 } });
      await vote("alice", "person1", { categoryVotes: { quality: -1 } });
      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM votes WHERE node_id = 'person1'`;
      expect(n).toBe(1);
      expect((await stored("person1_alice"))?.categoryVotes).toEqual({
        interesting: 2,
        quality: -1,
      });
    });

    it("names exactly one target", async () => {
      await vote("alice", "ex1", {
        kind: "extraction",
        categoryVotes: { correct: 1 },
      });
      expect(
        await status(
          vote("alice", "ex1", { categoryVotes: { interesting: 1 } }),
        ),
      ).toBe(409);
      expect(await stored("ex1_alice")).not.toHaveProperty("nodeId");
    });

    it("takes whole values from -5 to 5 only", async () => {
      for (const value of [6, -6, 2.5]) {
        expect(
          await status(
            vote("alice", "person1", { categoryVotes: { interesting: value } }),
          ),
        ).toBe(400);
      }
      expect(
        await status(
          vote("alice", "person1", { categoryVotes: { interesting: -5 } }),
        ),
      ).toBe(200);
    });

    it("holds at most 40 categories, counted after the merge", async () => {
      const many = (n: number, from = 0) =>
        Object.fromEntries(
          Array.from({ length: n }, (_, i) => [`c${from + i}`, 1]),
        );
      expect(
        await status(vote("alice", "person1", { categoryVotes: many(41) })),
      ).toBe(400);
      await vote("alice", "person1", { categoryVotes: many(40) });
      expect(
        await status(vote("alice", "person1", { categoryVotes: many(1, 40) })),
      ).toBe(400);
    });

    it("judges the whole map: a stored value out of range blocks another category until fixed", async () => {
      await sql`INSERT INTO votes (id, data) VALUES ('person1_alice',
        ${sql.json({ nodeId: "person1", userUid: "alice", categoryVotes: { interesting: 18 } })})`;
      expect(
        await status(
          vote("alice", "person1", { categoryVotes: { quality: 1 } }),
        ),
      ).toBe(400);
      expect(
        await status(
          vote("alice", "person1", { categoryVotes: { interesting: 3 } }),
        ),
      ).toBe(200);
    });

    it("lets only the owner delete, judged on the vote as stored", async () => {
      await sql`INSERT INTO votes (id, data) VALUES ('person1_alice',
        ${sql.json({ nodeId: "person1", userUid: "bob", categoryVotes: {} })})`;
      expect(
        await status(
          call(deleteVote, { as: "alice", params: { target: "person1" } }),
        ),
      ).toBe(403);
      expect(
        await status(
          call(deleteVote, { as: "alice", params: { target: "place1" } }),
        ),
      ).toBe(404);
      await vote("carol", "person1", { categoryVotes: { interesting: 1 } });
      expect(
        await status(
          call(deleteVote, { as: "carol", params: { target: "person1" } }),
        ),
      ).toBe(200);
      expect(await stored("person1_carol")).toBeUndefined();
    });

    it("keeps people from voting under a model's uid", async () => {
      expect(
        await status(
          vote("pipeline-pagerank", "person1", {
            categoryVotes: { interesting: 1 },
          }),
        ),
      ).toBe(403);
    });

    it("hands out only the reader's own votes", async () => {
      await vote("alice", "person1", { categoryVotes: { interesting: 2 } });
      await vote("bob", "place1", { categoryVotes: { interesting: 1 } });
      const mine = await call(mineVotes, {
        as: "alice",
        query: { targets: "person1,place1" },
      });
      expect(mine.votes).toEqual({
        person1: expect.objectContaining({ categoryVotes: { interesting: 2 } }),
      });
    });

    it("recounts an extraction's stats.votes in the same transaction", async () => {
      await vote("alice", "ex1", {
        kind: "extraction",
        categoryVotes: { correct: 1 },
      });
      const [{ data }] = await sql<
        { data: { stats: { votes: Record<string, unknown> } } }[]
      >`
        SELECT data FROM extractions WHERE id = 'ex1'`;
      expect(data.stats.votes).toMatchObject({ correct: 1, humanVoted: true });
    });

    it("moves the node's derived stats in the vote's transaction", async () => {
      await vote("alice", "person1", { categoryVotes: { interesting: 3 } });
      const [row] = await sql<{ stats: { votes: Record<string, unknown> } }[]>`
        SELECT stats FROM node_stats WHERE id = 'person1'`;
      expect(row!.stats.votes).toMatchObject({
        interesting: 3,
        humanVoted: true,
      });
    });
  });

  describe("pipeline votes", () => {
    const upload = (as: string, body: unknown) =>
      call(pipelinePost, { as, body });

    it("is for the datascience group only", async () => {
      expect(
        await status(upload("alice", { model: "pipeline-x", set: [] })),
      ).toBe(403);
    });

    it("writes under a model uid only", async () => {
      expect(
        await status(upload("ds,datascience", { model: "alice", set: [] })),
      ).toBe(400);
    });

    it("sets the interesting leaf, keeps other categories, and retracts", async () => {
      await sql`INSERT INTO votes (id, data) VALUES ('place1_pipeline-x',
        ${sql.json({ nodeId: "place1", userUid: "pipeline-x", categoryVotes: { quality: 2 } })})`;
      await upload("ds,datascience", {
        model: "pipeline-x",
        set: [
          { nodeId: "person1", score: 4 },
          { nodeId: "place1", score: 1 },
        ],
      });
      expect((await stored("place1_pipeline-x"))?.categoryVotes).toEqual({
        quality: 2,
        interesting: 1,
      });
      const read = await call(pipelineGet, {
        as: "ds,datascience",
        query: { model: "pipeline-x" },
      });
      expect(read.scores).toEqual({ person1: 4, place1: 1 });
      await upload("ds,datascience", {
        model: "pipeline-x",
        retract: ["person1"],
      });
      expect(await stored("person1_pipeline-x")).toBeUndefined();
    });
  });

  describe("notes", () => {
    const save = (as: string, nodeId: string, body: unknown) =>
      call(putNote, { as, params: { nodeId }, body });
    const list = (as: string | undefined, nodeId: string) =>
      call(notesGet, { as, query: { nodeId } }) as Promise<{
        notes: { id: string }[];
      }>;

    it("reads notes on a person to signed-in readers only", async () => {
      await save("alice", "person1", { sources: [{ note: "a" }] });
      await save("alice", "place1", { sources: [{ note: "b" }] });
      expect((await list(undefined, "person1")).notes).toEqual([]);
      expect((await list(undefined, "place1")).notes).toHaveLength(1);
      expect((await list(undefined, "missing")).notes).toEqual([]);
      expect((await list("bob", "person1")).notes).toHaveLength(1);
    });

    it("files the note at <nodeId>_<uid>, dated by the server, keeping createdAt", async () => {
      const first = (await save("alice", "person1", { sources: [] })) as {
        note: {
          id: string;
          createdAt: string;
          updatedAt: string;
          userUid: string;
        };
      };
      expect(first.note.id).toBe("person1_alice");
      expect(first.note.userUid).toBe("alice");
      const second = (await save("alice", "person1", {
        sources: [{ note: "x" }],
      })) as { note: { createdAt: string; updatedAt: string } };
      expect(second.note.createdAt).toBe(first.note.createdAt);
      expect(second.note.updatedAt >= first.note.updatedAt).toBe(true);
    });

    it("refuses to overwrite a note held at your id by somebody else", async () => {
      await sql`INSERT INTO notes (id, data) VALUES ('person1_alice',
        ${sql.json({ nodeId: "person1", userUid: "bob", sources: [] })})`;
      expect(await status(save("alice", "person1", { sources: [] }))).toBe(403);
      expect(
        await status(
          call(deleteNote, { as: "alice", params: { nodeId: "person1" } }),
        ),
      ).toBe(403);
    });

    it("lets the author delete their note", async () => {
      await save("alice", "place1", { sources: [] });
      expect(
        await status(
          call(deleteNote, { as: "alice", params: { nodeId: "place1" } }),
        ),
      ).toBe(200);
      expect(
        await status(
          call(deleteNote, { as: "alice", params: { nodeId: "place1" } }),
        ),
      ).toBe(404);
    });

    it("takes only the fields a note entry has", async () => {
      expect(
        await status(
          save("alice", "place1", { sources: [{ note: "a", evil: 1 }] }),
        ),
      ).toBe(400);
    });

    it("attaches article ids by url to the entries as stored", async () => {
      await save("alice", "place1", {
        sources: [{ note: "a", url: "https://example.com/a" }, { note: "b" }],
      });
      const answer = await call(attachArticles, {
        as: "alice",
        params: { nodeId: "place1" },
        body: {
          articleIds: { [normalizeUrl("https://example.com/a")]: "art1" },
        },
      });
      expect(answer.changed).toBe(true);
      const [{ data }] = await sql<
        { data: { sources: { articleNodeId?: string }[] } }[]
      >`
        SELECT data FROM notes WHERE id = 'place1_alice'`;
      expect(data.sources.map((s) => s.articleNodeId)).toEqual([
        "art1",
        undefined,
      ]);
    });
  });

  describe("users/{uid}", () => {
    it("reads and writes only the token's own document", async () => {
      await sql`INSERT INTO users (id, data) VALUES ('bob', ${sql.json({ displayName: "Bob" })})`;
      expect((await call(meGet, { as: "alice" })).config).toBeNull();
      await call(mePatch, { as: "alice", body: { displayName: "Ala" } });
      expect((await call(meGet, { as: "alice" })).config).toMatchObject({
        id: "alice",
        displayName: "Ala",
      });
      expect(await status(call(meGet, {}))).toBe(401);
    });

    it("takes only the fields the site writes", async () => {
      expect(
        await status(call(mePatch, { as: "alice", body: { photoURL: "x" } })),
      ).toBe(400);
      expect(
        await status(
          call(mePatch, {
            as: "alice",
            body: { notifications: { spam: true } },
          }),
        ),
      ).toBe(400);
    });

    it("merges maps key by key and stamps a newsletter change", async () => {
      await call(mePatch, {
        as: "alice",
        body: { notifications: { revisionApproved: false } },
      });
      await call(mePatch, {
        as: "alice",
        body: { notifications: { revisionRejected: false } },
      });
      const answer = await call(mePatch, {
        as: "alice",
        body: { newsletter: { recentPeople: true }, newsletterVia: "profil" },
      });
      expect(answer.config).toMatchObject({
        notifications: { revisionApproved: false, revisionRejected: false },
        newsletter: { recentPeople: true },
        newsletterUpdated: { via: "profil", at: expect.any(String) },
      });
      expect(
        await status(
          call(mePatch, {
            as: "alice",
            body: { newsletter: { recentPeople: false } },
          }),
        ),
      ).toBe(400);
    });
  });

  describe("qaChecks", () => {
    it("is read by anybody signed in, nobody else", async () => {
      await call(qaPut, {
        as: "alice",
        params: { itemId: "item-1" },
        body: { status: "issue", feedback: "broken" },
      });
      expect(await status(call(qaGet, {}))).toBe(401);
      const { checks } = (await call(qaGet, { as: "bob" })) as {
        checks: { userUid: string }[];
      };
      expect(checks.map((c) => c.userUid)).toEqual(["alice"]);
    });

    it("files a verdict at <itemId>_<uid>, and changing it keeps createdAt", async () => {
      const first = (await call(qaPut, {
        as: "alice",
        params: { itemId: "item-1" },
        body: { status: "issue" },
      })) as { check: { createdAt: string } };
      const second = (await call(qaPut, {
        as: "alice",
        params: { itemId: "item-1" },
        body: { status: "ok", userUid: "bob" },
      })) as { check: { createdAt: string; userUid: string; status: string } };
      expect(second.check).toMatchObject({ userUid: "alice", status: "ok" });
      expect(second.check.createdAt).toBe(first.check.createdAt);
      const ids = await sql`SELECT id FROM qa_checks`;
      expect(ids.map((r) => r.id)).toEqual(["item-1_alice"]);
    });
  });
});
