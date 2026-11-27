import { describe, it, expect, vi, beforeEach } from "vitest";
import { identify, listNewAdmins } from "../../../server/utils/contributors";

const { mockGetUsers, mockListUsers } = vi.hoisted(() => ({
  mockGetUsers: vi.fn(),
  mockListUsers: vi.fn(),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUsers: mockGetUsers, listUsers: mockListUsers }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("identify", () => {
  it("reads display data and roles from the account", async () => {
    mockGetUsers.mockResolvedValue({
      users: [
        {
          uid: "est",
          displayName: "Szymon",
          email: "s@example.com",
          customClaims: { admin: true },
        },
        {
          uid: "trial",
          displayName: "Mikołaj",
          customClaims: { admin: true, newAdmin: true },
        },
        // A trial ended by demotion that left the flag behind.
        { uid: "demoted", customClaims: { newAdmin: true } },
        { uid: "plain" },
      ],
      notFound: [{ uid: "gone" }],
    });

    const found = await identify(["est", "trial", "demoted", "plain", "gone"]);

    expect(found.est).toEqual({
      displayName: "Szymon",
      email: "s@example.com",
      photoURL: null,
      admin: true,
      newAdmin: false,
    });
    expect(found.trial).toMatchObject({ admin: true, newAdmin: true });
    expect(found.demoted).toMatchObject({ admin: false, newAdmin: false });
    expect(found.plain).toMatchObject({ admin: false, newAdmin: false });
    expect(found).not.toHaveProperty("gone");
  });

  it("asks the auth service at most 100 uids at a time", async () => {
    mockGetUsers.mockResolvedValue({ users: [], notFound: [] });
    const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);

    await identify(uids);

    expect(mockGetUsers.mock.calls.map(([ids]) => ids.length)).toEqual([
      100, 100, 50,
    ]);
  });

  it("asks nothing for nobody", async () => {
    expect(await identify([])).toEqual({});
    expect(mockGetUsers).not.toHaveBeenCalled();
  });
});

describe("listNewAdmins", () => {
  it("walks every page and keeps administrators on trial", async () => {
    mockListUsers.mockImplementation(async (_max: number, token?: string) =>
      token === "2"
        ? {
            users: [
              { uid: "trial-b", customClaims: { admin: true, newAdmin: true } },
            ],
          }
        : {
            users: [
              { uid: "trial-a", customClaims: { admin: true, newAdmin: true } },
              { uid: "est", customClaims: { admin: true } },
              { uid: "demoted", customClaims: { newAdmin: true } },
              { uid: "plain" },
            ],
            pageToken: "2",
          },
    );

    expect(await listNewAdmins()).toEqual(["trial-a", "trial-b"]);
    expect(mockListUsers.mock.calls).toEqual([
      [1000, undefined],
      [1000, "2"],
    ]);
  });

  it("stops after ten pages and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let page = 0;
    mockListUsers.mockImplementation(async () => {
      page += 1;
      return {
        users: [
          {
            uid: `trial-${page}`,
            customClaims: { admin: true, newAdmin: true },
          },
        ],
        pageToken: `after-${page}`,
      };
    });

    const found = await listNewAdmins();

    expect(mockListUsers).toHaveBeenCalledTimes(10);
    expect(found).toHaveLength(10);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
