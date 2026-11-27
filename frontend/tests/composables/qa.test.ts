import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useQaChecks } from "../../app/composables/qa";
import { submitFeedback } from "../../app/composables/feedback";
import type { QaCheck } from "../../shared/qa";

const user = ref<{ uid: string } | null>({ uid: "me" });

// A verdict goes out through the same intake as the "Zgłoś" button; what these
// tests care about is which verdicts get that far, and what they say.
vi.mock("../../app/composables/feedback", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../app/composables/feedback")>();
  return {
    ...actual,
    submitFeedback: vi.fn(async () => ({ id: "fb-1" })),
  };
});

/** /api/qa/checks as the server answers it: the stored verdicts, and a PUT
 * that files one at `<itemId>_<uid>`, keeping its createdAt. */
const server = vi.hoisted(() => ({ checks: [] as QaCheck[] }));
const { authRequest } = vi.hoisted(() => ({
  authRequest: vi.fn(
    async (
      url: string,
      options: { method?: string; body?: { status: string; feedback: string } },
    ) => {
      if (options.method === "GET") return { checks: server.checks };
      const itemId = decodeURIComponent(url.split("/").pop()!);
      const existing = server.checks.find(
        (c) => c.itemId === itemId && c.userUid === "me",
      );
      const check = {
        itemId,
        userUid: "me",
        status: options.body!.status,
        feedback: options.body!.feedback,
        createdAt: existing?.createdAt ?? "2026-11-26T00:00:00.000Z",
        updatedAt: "2026-11-26T00:00:01.000Z",
      };
      return { check };
    },
  ),
}));
vi.mock("../../app/composables/auth", () => ({
  useAuthState: () => ({ user }),
  authRequest,
}));

const reads = () =>
  authRequest.mock.calls.filter(([, o]) => o.method === "GET").length;
const writes = () =>
  authRequest.mock.calls.filter(([, o]) => o.method === "PUT");

beforeEach(async () => {
  vi.clearAllMocks();
  server.checks = [];
  // The composable shares its state through useState, and loading is skipped
  // for a user whose verdicts are already in hand - so each test starts by
  // signing out, which is what drops both.
  user.value = null;
  await useQaChecks().load();
  user.value = { uid: "me" };
  vi.clearAllMocks();
});

describe("useQaChecks", () => {
  it("reports nothing as loaded until this user's verdicts are read", async () => {
    const qa = useQaChecks();
    expect(qa.loaded.value).toBe(false);

    await qa.load();
    expect(qa.loaded.value).toBe(true);

    user.value = { uid: "someone-else" };
    expect(qa.loaded.value).toBe(false);
  });

  it("loads the verdicts once per user", async () => {
    server.checks = [{ itemId: "a", userUid: "me", status: "ok" }];

    const qa = useQaChecks();
    await qa.load();
    await qa.load();

    expect(reads()).toBe(1);
    expect(qa.stateOf("a")).toBe("ok");
  });

  it("leaves an entry unchecked when only somebody else has been through it", async () => {
    server.checks = [
      { itemId: "a", userUid: "other", status: "ok" },
      { itemId: "b", userUid: "other", status: "issue" },
    ];

    const qa = useQaChecks();
    await qa.load();

    expect(qa.stateOf("a")).toBe("unchecked");
    expect(qa.stateOf("b")).toBe("unchecked");
    // ...but their report is worth knowing about before starting.
    expect(qa.reportedByOthers("b")).toBe(true);
    expect(qa.reportedByOthers("a")).toBe(false);
  });

  it("re-reads for a different user and forgets the previous one", async () => {
    server.checks = [{ itemId: "a", userUid: "other", status: "ok" }];

    const qa = useQaChecks();
    await qa.load();

    user.value = null;
    await qa.load();
    expect(qa.checks.value).toEqual([]);

    user.value = { uid: "someone-else" };
    await qa.load();
    expect(reads()).toBe(2);
  });

  it("writes one verdict per item and user, through the API", async () => {
    const qa = useQaChecks();
    await qa.saveCheck("qa-changelog", "issue", "  nie działa  ");

    expect(writes()).toEqual([
      [
        "/api/qa/checks/qa-changelog",
        { method: "PUT", body: { status: "issue", feedback: "nie działa" } },
      ],
    ]);
  });

  it("shows the saved verdict without re-reading", async () => {
    const qa = useQaChecks();
    await qa.saveCheck("qa-changelog", "ok", "wygląda dobrze");

    expect(reads()).toBe(0);
    expect(qa.stateOf("qa-changelog")).toBe("ok");
    expect(qa.myCheck("qa-changelog")).toMatchObject({
      status: "ok",
      feedback: "wygląda dobrze",
    });
    expect(qa.counts.value.ok).toBe(1);
  });

  it("replaces this user's earlier verdict rather than adding a second", async () => {
    const qa = useQaChecks();
    await qa.saveCheck("qa-changelog", "issue", "źle");
    await qa.saveCheck("qa-changelog", "ok", "już dobrze");

    expect(qa.checksFor("qa-changelog")).toHaveLength(1);
    expect(qa.stateOf("qa-changelog")).toBe("ok");
  });

  it("keeps the date the first verdict was written", async () => {
    server.checks = [
      {
        itemId: "a",
        userUid: "me",
        status: "ok",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const qa = useQaChecks();
    await qa.load();

    await qa.saveCheck("a", "issue", "jednak nie");

    expect(qa.myCheck("a")?.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("sends a reported problem where every other report goes", async () => {
    const qa = useQaChecks();
    const result = await qa.saveCheck(
      "qa-changelog",
      "issue",
      "  filtr nie filtruje  ",
    );

    expect(result).toEqual({ reported: true, forwarded: true });
    const [draft, options] = vi.mocked(submitFeedback).mock.calls[0]!;
    expect(options).toEqual({ attribute: true });
    expect(draft.kind).toBe("bug");
    expect(draft.message).toBe("filtr nie filtruje");
    expect(draft.context.qa).toEqual({
      itemId: "qa-changelog",
      // Copied off the entry, so the Slack card reads right later.
      title: "Lista zmian do sprawdzenia",
      status: "issue",
    });
  });

  it("sends an approval that came with something to say", async () => {
    const qa = useQaChecks();
    await qa.saveCheck("qa-changelog", "ok", "działa, ale wolno");

    expect(submitFeedback).toHaveBeenCalledTimes(1);
    expect(vi.mocked(submitFeedback).mock.calls[0]![0].kind).toBe("idea");
  });

  it("keeps a bare tick to itself", async () => {
    const qa = useQaChecks();
    const result = await qa.saveCheck("qa-changelog", "ok");

    expect(result).toEqual({ reported: false, forwarded: false });
    expect(submitFeedback).not.toHaveBeenCalled();
    // The verdict is still this reader's own, and still recorded.
    expect(writes()).toHaveLength(1);
    expect(qa.stateOf("qa-changelog")).toBe("ok");
  });

  it("does not report the same verdict twice", async () => {
    const qa = useQaChecks();
    await qa.saveCheck("qa-changelog", "issue", "filtr nie filtruje");
    await qa.saveCheck("qa-changelog", "issue", "filtr nie filtruje");

    expect(submitFeedback).toHaveBeenCalledTimes(1);
    // Saving again is still a save - only the report is held back.
    expect(writes()).toHaveLength(2);

    await qa.saveCheck("qa-changelog", "ok", "już działa");
    expect(submitFeedback).toHaveBeenCalledTimes(2);
  });

  it("keeps the verdict when the report cannot get out", async () => {
    vi.mocked(submitFeedback).mockRejectedValueOnce(new Error("offline"));
    const qa = useQaChecks();

    const result = await qa.saveCheck("qa-changelog", "issue", "nie działa");

    // Saved first on purpose: a Slack outage costs the report, never the tick.
    expect(result).toEqual({ reported: true, forwarded: false });
    expect(qa.stateOf("qa-changelog")).toBe("issue");
  });

  it("refuses to save when nobody is logged in", async () => {
    user.value = null;
    const qa = useQaChecks();
    await expect(qa.saveCheck("a", "ok")).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });
});
