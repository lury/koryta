import { describe, it, expect, vi } from "vitest";
import { registerEndpoint } from "@nuxt/test-utils/runtime";
import { readBody } from "h3";
import { useAuthState } from "../../app/composables/auth";

/** The reader's settings (`users/{uid}`) go through /api/me, which the
 * server reads before it sends mail; the browser holds no Firestore handle
 * that could save them to the wrong database (decision on 2026-11-26). */

const patched = vi.hoisted(() => [] as unknown[]);

vi.mock("vuefire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuefire")>();
  return {
    ...actual,
    useFirebaseAuth: vi.fn(() => ({ currentUser: null })),
    useCurrentUser: vi.fn(() =>
      ref({ uid: "me", getIdToken: async () => "token" }),
    ),
    useIsCurrentUserLoaded: vi.fn(() => ref(true)),
  };
});
vi.mock("~/utils/tokenRefresh", () => ({
  idTokenResultIfReachable: async () => ({ claims: {} }),
  idTokenWhenOnline: async () => "token",
  ignoreNetworkFailure: () => {},
}));

registerEndpoint("/api/me", {
  method: "PATCH",
  handler: async (event) => {
    const body = await readBody(event);
    patched.push(body);
    return { config: { id: "me", ...body } };
  },
});
registerEndpoint("/api/me", {
  method: "GET",
  handler: () => ({ config: null }),
});

describe("user config storage", () => {
  it("saves a preference through PATCH /api/me and keeps the answer", async () => {
    const { userConfig } = useAuthState();
    await userConfig.save({ notifications: { revisionApproved: false } });

    expect(patched).toEqual([{ notifications: { revisionApproved: false } }]);
    expect(userConfig.data.value).toMatchObject({
      notifications: { revisionApproved: false },
    });
  });
});
