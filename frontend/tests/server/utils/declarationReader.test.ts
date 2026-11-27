import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getReader, isCountedReader } from "../../../server/utils/declarations";

/** Who reads the crops (server/utils/declarations.ts): the rules the
 * Postgres reads and writes keep, with no database behind them. */

const { verifyIdToken } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globals.createError = (err: any) =>
    Object.assign(new Error(err.message), err);
  // Node hands h3 the headers lower-cased, whatever the browser sent.
  globals.getRequestHeader = (
    event: { headers: Record<string, string> },
    name: string,
  ) => event.headers[name.toLowerCase()];
  return { verifyIdToken: vi.fn() };
});

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken }),
}));

/** A browser's reader id, as `crypto.randomUUID()` makes one. */
const readerId = (n: number) =>
  `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, "0")}`;

/** A signed-in account, as its token decodes: a confirmed address unless
 * told otherwise. */
function account(uid: string, fields: Partial<DecodedIdToken> = {}) {
  return {
    uid,
    email_verified: true,
    firebase: { sign_in_provider: "password" },
    ...fields,
  } as unknown as DecodedIdToken;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isCountedReader", () => {
  it("counts a Google account or a confirmed address, not a bare password account", () => {
    expect(isCountedReader(account("a"))).toBe(true);
    expect(
      isCountedReader(
        account("b", {
          email_verified: false,
          firebase: {
            sign_in_provider: "google.com",
          } as DecodedIdToken["firebase"],
        }),
      ),
    ).toBe(true);
    expect(isCountedReader(account("c", { email_verified: false }))).toBe(
      false,
    );
  });
});

describe("getReader", () => {
  const request = (headers: Record<string, string>) =>
    getReader({ headers } as never);

  it("reads a signed-in reader by their token, with a vote", async () => {
    verifyIdToken.mockResolvedValue(account("a"));
    await expect(request({ authorization: "Bearer token" })).resolves.toEqual({
      uid: "a",
      votes: true,
      anonymous: false,
    });
  });

  it("lets an account without a confirmed address read, without a vote", async () => {
    verifyIdToken.mockResolvedValue(account("u", { email_verified: false }));
    await expect(request({ authorization: "Bearer token" })).resolves.toEqual({
      uid: "u",
      votes: false,
      anonymous: false,
    });
  });

  it("files a reader without an account under their reader id, lower-cased", async () => {
    await expect(
      request({ "x-reader-id": readerId(7).toUpperCase() }),
    ).resolves.toEqual({
      uid: `anon:${readerId(7)}`,
      votes: false,
      anonymous: true,
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("refuses a bad token even beside a reader id", async () => {
    verifyIdToken.mockRejectedValue(new Error("expired"));
    await expect(
      request({ authorization: "Bearer stale", "x-reader-id": readerId(7) }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      request({ authorization: "Basic abc", "x-reader-id": readerId(7) }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("refuses a request with neither, or with a reader id that is no version 4 UUID", async () => {
    await expect(request({})).rejects.toMatchObject({ statusCode: 401 });
    for (const id of [
      "reader",
      `${readerId(7)}0`,
      // Version 1, and a version 4 without its variant bits.
      "0f8fad5b-d9cb-169f-a165-000000000007",
      "0f8fad5b-d9cb-469f-c165-000000000007",
      ` ${readerId(7)}`,
    ]) {
      await expect(request({ "x-reader-id": id })).rejects.toMatchObject({
        statusCode: 401,
      });
    }
  });
});
