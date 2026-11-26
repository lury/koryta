import type { TestEvent } from "./pgHarness";

/** What the declaration handlers' pg tests share: the Nitro auto-imports read
 * off the test's event, the Firebase token a test sends, and the cache the
 * handlers clear. Imported first, so that the globals are there. */

installGlobals();

function installGlobals() {
  const g = globalThis as Record<string, unknown>;
  type Event = {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    headers: Record<string, string>;
    context: Record<string, unknown>;
  };
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.defineCachedEventHandler = (fn: unknown) => fn;
  g.defineCachedFunction = (fn: unknown) => fn;
  g.getRouterParam = (event: Event, name: string) => event.params?.[name];
  g.getQuery = (event: Event) => event.query ?? {};
  // A query the parser refuses throws its ZodError, which `statusOf` reads
  // as the 400 h3 answers.
  g.getValidatedQuery = async (event: Event, parse: (q: unknown) => unknown) =>
    parse(event.query ?? {});
  g.getRequestHeader = (event: Event, name: string) =>
    event.headers[name.toLowerCase()];
  g.readValidatedBody = async (event: Event, parse: (b: unknown) => unknown) =>
    parse(event.body);
  g.setResponseHeader = (event: Event, name: string, value: string) => {
    event.context[`header:${name}`] = value;
  };
  const clearedKeys: string[] = [];
  g.__cleared = clearedKeys;
  g.useStorage = () => ({
    clear: async (base: string) => {
      clearedKeys.push(base);
    },
  });
}

/** The token a test's `Bearer <uid>[,claim...]` stands for: `verified` is a
 * confirmed address, any other claim is set true. Each test file mocks
 * firebase-admin/auth with it. */
export function decodeTestToken(token: string) {
  const [uid, ...claims] = token.split(",");
  const flags = Object.fromEntries(
    claims.filter((c) => c !== "verified").map((c) => [c, true]),
  );
  return {
    uid,
    email_verified: claims.includes("verified"),
    firebase: { sign_in_provider: "password" },
    ...flags,
  };
}

/** Calls a handler as `as` (`<uid>[,claim...]`), or as a browser with only a
 * reader id. */
export function call<T = unknown>(
  handler: unknown,
  as: string | undefined,
  event: Partial<TestEvent> & { readerId?: string } = {},
): Promise<T> {
  const { readerId, ...rest } = event;
  return (handler as (event: TestEvent) => Promise<T>)({
    headers: {
      ...(as ? { authorization: `Bearer ${as}` } : {}),
      ...(readerId ? { "x-reader-id": readerId } : {}),
    },
    context: {},
    ...rest,
  });
}

/** The cache bases the handlers cleared since the last call. */
export function takeCleared(): string[] {
  const keys = (globalThis as unknown as { __cleared: string[] }).__cleared;
  return keys.splice(0, keys.length);
}

/** A crop id. */
export const cropId = (n: number) => `${String(n).padStart(64, "a")}-p0`;

/** A 1x1 PNG as stored bytes. */
export const PNG = {
  $bytes:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
};

/** A Warsaw midday, outside the people import's night window. */
export const MIDDAY = new Date("2026-11-27T11:00:00Z");
