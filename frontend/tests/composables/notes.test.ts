import { describe, it, expect, vi, beforeEach } from "vitest";
import { effectScope, nextTick, ref, type EffectScope, type Ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useNotes } from "../../app/composables/notes";

const user: Ref<{ uid: string } | null> = ref(null);
const { authRequest } = vi.hoisted(() => ({
  authRequest: vi.fn(async (url: string, _options?: unknown) =>
    url === "/api/notes" ? { notes: [] } : {},
  ),
}));

vi.mock("../../app/composables/auth", () => ({
  useAuthState: () => ({ user }),
  authRequest,
}));
vi.mock("../../app/composables/votes", () => ({
  useContributionsTick: () => ref(0),
}));

/** The node ids GET /api/notes was asked about. */
const asked = () =>
  authRequest.mock.calls
    .filter(([url]) => url === "/api/notes")
    .map(
      ([, options]) => (options as { query: { nodeId: string } }).query.nodeId,
    );

let scope: EffectScope | undefined;
const notesOf = (...args: Parameters<typeof useNotes>) =>
  scope!.run(() => useNotes(...args))!;

describe("useNotes", () => {
  beforeEach(() => {
    user.value = null;
    authRequest.mockClear();
    scope?.stop();
    scope = effectScope();
  });

  it("does not ask for a person's notes for a logged out reader", async () => {
    // GET /api/notes answers nothing for them anyway.
    notesOf("person-1", "person");
    await flushPromises();
    expect(asked()).toEqual([]);
  });

  it("asks once the reader signs in", async () => {
    notesOf("person-1", "person");
    user.value = { uid: "reader" };
    await nextTick();
    await flushPromises();
    expect(asked()).toEqual(["person-1"]);
  });

  it("asks for a company's notes whoever is reading", async () => {
    notesOf("company-1", "place");
    await flushPromises();
    expect(asked()).toEqual(["company-1"]);
  });

  it("saves through PUT /api/notes/:nodeId and shows the stored note", async () => {
    user.value = { uid: "reader" };
    const stored = { userUid: "reader", nodeId: "company-1", sources: [] };
    authRequest.mockImplementation(async (url: string) =>
      url === "/api/notes" ? { notes: [] } : { note: stored },
    );
    const { saveNote, userNote } = notesOf("company-1", "place");
    await flushPromises();
    await saveNote({ sources: [] });
    expect(authRequest).toHaveBeenCalledWith("/api/notes/company-1", {
      method: "PUT",
      body: { sources: [] },
    });
    expect(userNote.value).toEqual(stored);
  });
});
