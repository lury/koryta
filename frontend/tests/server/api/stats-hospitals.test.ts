import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/stats/hospitals.get";

const { fromDb } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.defineEventHandler = (fn: unknown) => fn;
  return { fromDb: vi.fn() };
});

// The counting is hospital_stats() in SQL, held against buildHospitalStats
// by tests/server/db/statsSql.pg.test.ts; here only what the handler asks.
vi.mock("~~/server/db/stats", () => ({ hospitalStatsFromDb: fromDb }));

// The handler is wrapped in nitro's cache; here it runs straight through.
// Recorded rather than merely stubbed: which wrapper this endpoint uses is the
// difference between an editor seeing what they just published and being served
// an edge-cached answer from up to six hours earlier, so the choice is asserted
// below rather than left to the import.
// A plain array rather than a spy, and `vi.hoisted` rather than a `const`: the
// wrapping happens once, when the module is imported, which is before any
// `beforeEach` - so a spy would have its one recorded call wiped by
// `clearAllMocks` long before the assertion, and a `const` would still be in
// its temporal dead zone when `vi.mock`'s factory runs.
const { wrappedWith } = vi.hoisted(() => ({ wrappedWith: [] as string[] }));
vi.mock("~~/server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => {
    wrappedWith.push("authCachedEventHandler");
    return fn;
  },
  editorFreshCachedEventHandler: (fn: unknown) => {
    wrappedWith.push("editorFreshCachedEventHandler");
    return fn;
  },
}));

const call = () =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/stats/hospitals", () => {
  it("lets an editor read through the cache", async () => {
    // The plain cached wrapper sends `s-maxage=21600`, so Cloud CDN holds a
    // copy that no server-side cache clear can reach - an admin who publishes a
    // board member and reloads the page is shown the answer from before they
    // did it. `editorFresh` answers a `latest` request `no-store` instead,
    // which is the only instruction the CDN takes.
    expect(wrappedWith).toEqual(["editorFreshCachedEventHandler"]);
  });

  it("answers what the database counts on today's date in UTC", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T23:30:00+01:00") });
    fromDb.mockResolvedValue({ hospitals: 3 });

    expect(await call()).toEqual({ hospitals: 3 });
    expect(fromDb).toHaveBeenCalledWith(
      "2026-11-27",
      "2026-11-27T22:30:00.000Z",
    );
    vi.useRealTimers();
  });
});
