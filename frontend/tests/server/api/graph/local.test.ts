import { describe, it, expect, vi, beforeEach } from "vitest";
import { withQuery } from "ufo";
import getHandler from "../../../../server/api/graph/local/[id].get";
import postHandler from "../../../../server/api/graph/local/[id].post";

/** What each request asked `getLocalGraph` for. Hoisted with the nitro
 * globals, which have to exist before the routes are imported. */
const asked = vi.hoisted(() => {
  const asked = {
    showUnapproved: [] as boolean[],
    /** Distance, expansions and subjects, per request. */
    reach: [] as [number, string[], string[] | undefined][],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedEventHandler = (fn: any) => fn;
  globalThis.setResponseHeader = (() => {}) as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  return asked;
});

vi.mock("../../../../server/utils/localGraph", () => ({
  getLocalGraph: async (
    _focus: string,
    showUnapproved: boolean,
    distance: number,
    expansions: string[],
    peers?: string[],
  ) => {
    asked.showUnapproved.push(showUnapproved);
    asked.reach.push([distance, expansions, peers]);
    return { nodes: {}, edges: [], nodeGroups: [] };
  },
}));
// A bearer header is a signed in reader; Firebase is not what is under test.
vi.mock("../../../../server/utils/auth", () => ({
  getOptionalUser: async (event: { headers?: Record<string, string> }) =>
    event.headers?.authorization ? { uid: "reader" } : null,
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
  getQuery: (event: { query?: Record<string, string> }) => event.query ?? {},
  getRouterParam: () => "person-1",
  readBody: async (event: { body?: unknown }) => event.body,
}));

function request(
  options: {
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    signedIn?: boolean;
  } = {},
) {
  const headers: Record<string, string> = options.signedIn
    ? { authorization: "Bearer token" }
    : {};
  // What h3's own validators read: the url's query, and the request's body.
  const method = options.body === undefined ? "GET" : "POST";
  return {
    method,
    path: withQuery("/api/graph/local/person-1", options.query ?? {}),
    node: { req: { method, headers, body: options.body } },
    query: options.query ?? {},
    body: options.body,
    headers,
    context: {},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (handler: any, event: ReturnType<typeof request>) =>
  handler(event);

describe("/api/graph/local/[id]", () => {
  beforeEach(() => {
    asked.showUnapproved.length = 0;
    asked.reach.length = 0;
  });

  it("draws a logged out reader who types `latest` the published graph", async () => {
    // Verified against production on 2026-09-14 with no Authorization header:
    // the same url drew 13 unpublished people by name once `&latest=true` was
    // on it.
    await call(getHandler, request({ query: { latest: "true" } }));
    expect(asked.showUnapproved).toEqual([false]);
  });

  it("draws a signed in reader the drafts", async () => {
    await call(
      getHandler,
      request({ query: { latest: "true" }, signedIn: true }),
    );
    expect(asked.showUnapproved).toEqual([true]);
  });

  it("gives a POST's `latest` to a token only", async () => {
    // The table's request, which sent `latest: true` for every reader.
    const body = { subjects: "person-2", distance: 1, latest: true };
    await call(postHandler, request({ body }));
    await call(postHandler, request({ body, signedIn: true }));
    expect(asked.showUnapproved).toEqual([false, true]);
  });

  it("draws a signed in reader who does not ask the published graph", async () => {
    await call(
      postHandler,
      request({ body: { latest: false }, signedIn: true }),
    );
    expect(asked.showUnapproved).toEqual([false]);
  });

  it("asks for the reach the GET always clamped to", async () => {
    await call(getHandler, request());
    await call(getHandler, request({ query: { distance: "2" } }));
    await call(getHandler, request({ query: { distance: "0" } }));
    await call(getHandler, request({ query: { distance: "9" } }));
    expect(asked.reach.map(([distance]) => distance)).toEqual([1, 2, 1, 3]);
  });

  it("reads `expand` as the comma-separated list the canvas sends", async () => {
    await call(
      getHandler,
      request({ query: { expand: "company-1,person-2" } }),
    );
    expect(asked.reach[0]![1]).toEqual(["company-1", "person-2"]);
  });

  it("refuses a GET whose distance is not a whole number", async () => {
    for (const distance of ["abc", "1.5"]) {
      await expect(
        call(getHandler, request({ query: { distance } })),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(asked.reach).toEqual([]);
  });

  it("caps a POST's distance as the GET's is capped", async () => {
    // The POST took any number: one request could walk the graph a thousand
    // hops out, one Firestore round trip per hop.
    await call(postHandler, request({ body: { distance: 1000 } }));
    await call(postHandler, request({ body: { distance: "2" } }));
    await call(postHandler, request({ body: {} }));
    expect(asked.reach.map(([distance]) => distance)).toEqual([3, 2, 1]);
  });

  it("reads `subjects` and `expand` from a string or an array", async () => {
    // The table's request, as `listWithStats` sends it.
    const body = { subjects: "person-2, person-3,", distance: 1 };
    await call(postHandler, request({ body }));
    await call(
      postHandler,
      request({ body: { subjects: ["person-2"], expand: ["company-1"] } }),
    );
    expect(asked.reach).toEqual([
      [1, [], ["person-2", "person-3"]],
      [1, ["company-1"], ["person-2"]],
    ]);
  });

  it("refuses a POST naming more ids than a page of the table holds", async () => {
    const subjects = Array.from({ length: 201 }, (_, i) => `person-${i}`);
    await expect(
      call(postHandler, request({ body: { subjects } })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      call(postHandler, request({ body: { distance: "far" } })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      call(postHandler, request({ body: { expand: ["nodes/x"] } })),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(asked.reach).toEqual([]);
  });
});
