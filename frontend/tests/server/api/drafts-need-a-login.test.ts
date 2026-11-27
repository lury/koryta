import { describe, it, expect, vi, beforeEach } from "vitest";
import revisionById from "../../../server/api/revisions/[id].get";
import revisionsByNode from "../../../server/api/revisions/byNode.get";
import nodesWithRevisions from "../../../server/api/nodes/revisions.get";
import pendingNodes from "../../../server/api/nodes/pending.get";

/** Whether Postgres was reached at all, and what the routes said about
 * caching. Hoisted with the nitro globals the routes reach for unimported. */
const state = vi.hoisted(() => {
  const state = {
    reads: 0,
    cacheControl: undefined as string | undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // server/utils/fetch.ts, which /api/nodes/revisions pages through, wraps
  // one at module load.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = (fn: any) => fn;
  globalThis.getRouterParam = (() => "rev-1") as never;
  globalThis.getQuery = (() => ({ nodeId: "person-1" })) as never;
  globalThis.getValidatedQuery = (async (
    _event: unknown,
    parse: (q: unknown) => unknown,
  ) => parse({})) as never;
  return state;
});

/** A Postgres pool whose every statement finds nothing, and counts the asking:
 * a statement counts once it is awaited, a fragment inside one never is. */
vi.mock("../../../server/db/client", () => {
  const statement = () => ({
    then: (resolve: (rows: unknown[]) => unknown) => {
      state.reads += 1;
      return Promise.resolve([]).then(resolve);
    },
  });
  const sql = (first: unknown) =>
    Array.isArray(first) && "raw" in (first as object)
      ? statement()
      : { identifier: first };
  Object.assign(sql, { unsafe: (text: string) => ({ unsafe: text }) });
  return { useDb: () => sql };
});
// `getUser` as it behaves: a bearer header is a reader, no header is a 401.
vi.mock("../../../server/utils/auth", () => ({
  getUser: async (event: { headers?: Record<string, string> }) => {
    if (!event.headers?.authorization) {
      throw { statusCode: 401, message: "brak tokenu" };
    }
    return { uid: "reader" };
  },
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
  getValidatedQuery: async (_event: unknown, parse: (q: unknown) => unknown) =>
    parse({}),
  setResponseHeader: (_event: unknown, name: string, value: string) => {
    if (name === "Cache-Control") state.cacheControl = value;
  },
}));

/** Every route that hands out drafts or revisions whole, by the url it is
 * served at. */
const routes = {
  "/api/revisions/[id]": revisionById,
  "/api/revisions/byNode": revisionsByNode,
  "/api/nodes/revisions": nodesWithRevisions,
  "/api/nodes/pending": pendingNodes,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (route: any, signedIn: boolean) =>
  route({
    headers: signedIn ? { authorization: "Bearer token" } : {},
    context: {},
  });

describe.each(Object.entries(routes))("%s", (_url, route) => {
  beforeEach(() => {
    state.reads = 0;
    state.cacheControl = undefined;
  });

  it("refuses a logged out caller before reading anything", async () => {
    // /api/revisions/byNode answered a curl with no token on production on
    // 2026-10-01 and again on 2026-10-14, every revision's parties included,
    // and none of the others read a token at all.
    await expect(call(route, false)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(state.reads).toBe(0);
  });

  it("answers a signed in reader, and lets nothing keep the answer", async () => {
    // A missing revision is a 404 from /api/revisions/[id]; whatever the
    // answer, it was reached past the login and not stored on the way out.
    await call(route, true).catch((error: { statusCode?: number }) => {
      expect(error.statusCode).toBe(404);
    });
    expect(state.reads).toBeGreaterThan(0);
    expect(state.cacheControl).toMatch(/no-store/);
  });
});
