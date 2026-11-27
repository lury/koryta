import { describe, it, expect, vi } from "vitest";
import { fetchOptionsValidator, pageOf } from "../../../server/utils/fetch";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // server/utils/fetch.ts wraps a Nitro auto-import at module load.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = (fn: any) => fn;
});

describe("fetchOptionsValidator", () => {
  it("takes a page size and a page from the query string", () => {
    expect(fetchOptionsValidator.parse({ limit: "25", page: "3" })).toEqual({
      limit: 25,
      page: 3,
    });
  });

  // Vuetify's "all rows" option asks for `limit=-1`: a bad request, not a
  // 500.
  it.each([["-1"], ["0"], ["2.5"]])("refuses limit=%s", (limit) => {
    expect(fetchOptionsValidator.safeParse({ limit }).success).toBe(false);
  });

  it("refuses page=0", () => {
    expect(
      fetchOptionsValidator.safeParse({ limit: "10", page: "0" }).success,
    ).toBe(false);
  });
});

describe("pageOf", () => {
  it("skips the pages before the one asked for", () => {
    expect(pageOf({ limit: 25, page: 3 })).toEqual({ offset: 50, limit: 25 });
  });

  it("leaves the list whole when no page size is asked for", () => {
    expect(pageOf({})).toEqual({ offset: 0, limit: undefined });
  });

  // For the routes with a query schema of their own, which do not go through
  // `fetchOptionsValidator`.
  it.each([[{ limit: -1 }], [{ limit: 2.5 }], [{ limit: 10, page: -2 }]])(
    "answers %o with a 400",
    (options) => {
      expect(() => pageOf(options)).toThrow(
        expect.objectContaining({ statusCode: 400 }),
      );
    },
  );
});
