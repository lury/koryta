import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../../../server/api/stats/compute.post";

/** POST /api/stats/compute: a recount of every article and edge, for an
 * admin only (decision on 2026-11-27). */

const { fetchNodes, fetchEdges, writeStats } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return {
    fetchNodes: vi.fn(),
    fetchEdges: vi.fn(),
    writeStats: vi.fn(),
  };
});

vi.mock("~~/server/utils/fetch", () => ({ fetchNodes, fetchEdges }));
vi.mock("~~/server/db/domainStats", () => ({
  writeDomainArticleStatsPg: writeStats,
}));

// Faked at the token: `getUser` and `requireAdmin` run for real.
const mockVerifyIdToken = vi.fn();
vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

let authHeader: string | undefined;
globalThis.getRequestHeader = ((_event: unknown, name: string) =>
  name === "Authorization"
    ? authHeader
    : undefined) as typeof globalThis.getRequestHeader;

async function status(): Promise<number> {
  try {
    await (handler as unknown as (event: unknown) => Promise<unknown>)({});
    return 200;
  } catch (error) {
    return (error as { statusCode: number }).statusCode;
  }
}

describe("POST /api/stats/compute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authHeader = undefined;
    fetchNodes.mockResolvedValue({
      a1: { type: "article", sourceURL: "https://www.zet.pl/tekst" },
    });
    fetchEdges.mockResolvedValue([
      { id: "e1", source: "a1", target: "p1", type: "mentions" },
    ]);
  });

  it("refuses a caller without a token before reading anything", async () => {
    expect(await status()).toBe(401);
    expect(fetchNodes).not.toHaveBeenCalled();
    expect(writeStats).not.toHaveBeenCalled();
  });

  it("refuses an invalid token", async () => {
    authHeader = "Bearer broken";
    mockVerifyIdToken.mockRejectedValue(new Error("bad token"));
    expect(await status()).toBe(401);
    expect(fetchNodes).not.toHaveBeenCalled();
  });

  it("refuses a signed-in user who is not an admin", async () => {
    authHeader = "Bearer user";
    mockVerifyIdToken.mockResolvedValue({ uid: "u1", datascience: true });
    expect(await status()).toBe(403);
    expect(fetchNodes).not.toHaveBeenCalled();
    expect(writeStats).not.toHaveBeenCalled();
  });

  it("recounts for an admin", async () => {
    authHeader = "Bearer admin";
    mockVerifyIdToken.mockResolvedValue({ uid: "a1", admin: true });
    const answer = await (
      handler as unknown as (event: unknown) => Promise<unknown>
    )({});
    expect(answer).toEqual({ status: "success", computedDomains: 1 });
    expect(writeStats).toHaveBeenCalledWith([
      expect.objectContaining({ id: "domain_articles_zet_pl" }),
    ]);
  });
});
