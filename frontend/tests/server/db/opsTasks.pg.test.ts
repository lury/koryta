import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from "vitest";
import type postgres from "postgres";
import listHandler from "~~/server/api/ops/tasks/list.get";
import createHandler from "~~/server/api/ops/tasks/create.post";
import updateHandler from "~~/server/api/ops/tasks/update.post";
import { requireOwner } from "~~/server/utils/auth";
import { listTasksPg } from "~~/server/db/ops";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { Mirror } from "./mirror";

/** The owner's task list on Postgres (`ops.tasks`).
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/opsTasks.pg.test.ts
 */

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => parser(event.body),
  };
});

vi.mock("~~/server/utils/auth", () => ({
  requireOwner: vi.fn(),
}));

// Spied on, passing through: whether a refused caller read anything.
vi.mock("~~/server/db/ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/db/ops")>();
  return { ...actual, listTasksPg: vi.fn(actual.listTasksPg) };
});

let sql: postgres.Sql;
const mirror = new Mirror(() => sql, ["ops.tasks"]);
/** `ops.tasks`, by id. */
const docs = mirror.docs("ops.tasks");

const call = (handler: unknown, body?: unknown) =>
  mirror.around(() =>
    (handler as (event: unknown) => Promise<Record<string, unknown>>)({ body }),
  );

const at = (iso: string) => new Date(iso).toISOString();

function stored(id: string, fields: Record<string, unknown> = {}) {
  docs.set(id, {
    title: `Task ${id}`,
    body: "",
    kind: "action",
    who: "owner",
    status: "open",
    dependsOn: [],
    tags: [],
    links: [],
    branches: [],
    createdAt: at("2026-09-28T08:00:00Z"),
    updatedAt: at("2026-09-28T08:00:00Z"),
    createdBy: "agent:bridge-cse_01",
    log: [],
    ...fields,
  });
}

describe.runIf(PG_TEST_DATABASE_URL)("/api/ops/tasks", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("ops_tasks");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mirror.clear();
    vi.mocked(requireOwner).mockResolvedValue({ uid: "owner" } as never);
  });

  it("refuses anybody but the owner before reading anything", async () => {
    vi.mocked(requireOwner).mockRejectedValue(
      Object.assign(new Error("no"), { statusCode: 403 }),
    );
    for (const [handler, body] of [
      [listHandler, undefined],
      [createHandler, { title: "x" }],
      [updateHandler, { id: "x", patch: { status: "done" } }],
    ] as const) {
      await expect(call(handler, body)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    expect(listTasksPg).not.toHaveBeenCalled();
  });

  it("lists the tasks from the ops schema, times as ISO strings", async () => {
    stored("merge-x", {
      log: [{ at: at("2026-09-28T09:00:00Z"), by: "owner", text: "Hi." }],
    });
    const { tasks } = await call(listHandler);
    expect(tasks).toEqual([
      expect.objectContaining({
        id: "merge-x",
        createdAt: "2026-09-28T08:00:00.000Z",
        log: [{ at: "2026-09-28T09:00:00.000Z", by: "owner", text: "Hi." }],
      }),
    ]);
  });

  it("adds a task as the owner, under an id made from its title", async () => {
    stored("merge-x");
    const { task } = await call(createHandler, {
      title: "Deploy the rules",
      dependsOn: ["merge-x"],
    });
    expect(task).toMatchObject({
      id: "deploy-the-rules",
      createdBy: "owner",
      dependsOn: ["merge-x"],
    });
    const doc = docs.get("deploy-the-rules")!;
    expect(doc.createdAt).toBe(task.createdAt);
    expect(doc.id).toBeUndefined();
  });

  it("refuses an id another task has, and gives a repeated title its own", async () => {
    stored("deploy-the-rules");
    await expect(
      call(createHandler, { id: "deploy-the-rules", title: "Again" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(docs.get("deploy-the-rules")!.title).toBe("Task deploy-the-rules");

    const { task } = await call(createHandler, { title: "Deploy the rules" });
    expect(task.id).toBe("deploy-the-rules-2");
    expect([...docs.keys()].sort()).toEqual([
      "deploy-the-rules",
      "deploy-the-rules-2",
    ]);
  });

  it("refuses a dependency on a task that does not exist", async () => {
    await expect(
      call(createHandler, { title: "Later", dependsOn: ["nope"] }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/nope/),
    });
    expect(docs.size).toBe(0);
  });

  it("closes a task, stamping when", async () => {
    stored("merge-x");
    const { task } = await call(updateHandler, {
      id: "merge-x",
      patch: { status: "done" },
    });
    expect(task).toMatchObject({
      status: "done",
      closedAt: expect.any(String),
    });
    expect(docs.get("merge-x")!.closedAt).toBe(
      (task as { closedAt: string }).closedAt,
    );
    expect((docs.get("merge-x")!.log as unknown[]).length).toBe(1);
  });

  it("refuses a dependency that would close a loop, and leaves the task", async () => {
    stored("a");
    stored("b", { dependsOn: ["a"] });
    await expect(
      call(updateHandler, { id: "a", patch: { addDependsOn: ["b"] } }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/a → b → a/),
    });
    expect(docs.get("a")!.dependsOn).toEqual([]);
  });

  it("picks an answer, and closes the decision with the last task after it", async () => {
    const options = [
      { key: "A", title: "Move them" },
      { key: "B", title: "Take them over" },
    ];
    stored("decide", { kind: "decision", options, question: "How?" });
    stored("merge-a", { dependsOn: ["decide"] });
    const picked = await call(updateHandler, {
      id: "decide",
      patch: { pick: "A" },
    });
    expect(picked.task).toMatchObject({
      status: "doing",
      picked: { key: "A", by: "owner", at: expect.any(String) },
    });
    expect(picked.also).toEqual([]);
    // Stored as an ISO string, like the history's times, and read back.
    const pick = docs.get("decide")!.picked as { at: unknown };
    expect(pick.at).toBe((picked.task as { picked: { at: string } }).picked.at);
    const { tasks } = await call(listHandler);
    const listed = (tasks as { id: string; picked?: { at: string } }[]).find(
      (t) => t.id === "decide",
    );
    expect(listed!.picked!.at).toBe(
      (picked.task as { picked: { at: string } }).picked.at,
    );

    const closed = await call(updateHandler, {
      id: "merge-a",
      patch: { status: "done" },
    });
    expect(closed.also).toMatchObject([{ id: "decide", status: "done" }]);
    expect(docs.get("decide")!.status).toBe("done");
  });

  it("refuses a merge with no branch", async () => {
    await expect(
      call(createHandler, { title: "Merge it", kind: "merge" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/gałęzi/),
    });
    expect(docs.size).toBe(0);
  });

  it("judges two changes at once against the list each leaves, one after the other", async () => {
    await mirror.push();
    const [a, b] = await Promise.allSettled([
      (createHandler as (e: unknown) => Promise<unknown>)({
        body: { title: "Same title" },
      }),
      (createHandler as (e: unknown) => Promise<unknown>)({
        body: { title: "Same title" },
      }),
    ]);
    await mirror.pull();
    expect([a.status, b.status]).toEqual(["fulfilled", "fulfilled"]);
    expect([...docs.keys()].sort()).toEqual(["same-title", "same-title-2"]);
  });

  it("answers 404 for a task that is not there", async () => {
    await expect(
      call(updateHandler, { id: "nope", patch: { note: "x" } }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("sets a priority as the owner, and takes it away again", async () => {
    stored("leak", {
      priority: "high",
      prioritySetBy: "agent:bridge-cse_01",
    });
    // Lowering an agent's level, raising it, any of it: the owner may.
    const { task } = await call(updateHandler, {
      id: "leak",
      patch: { priority: "urgent" },
    });
    expect(task).toMatchObject({ priority: "urgent", prioritySetBy: "owner" });
    expect(docs.get("leak")).toMatchObject({
      priority: "urgent",
      prioritySetBy: "owner",
    });

    await call(updateHandler, { id: "leak", patch: { priority: "normal" } });
    expect(docs.get("leak")!.priority).toBeUndefined();
    expect(docs.get("leak")!.prioritySetBy).toBeUndefined();
    expect(
      (docs.get("leak")!.log as { text: string }[]).map((e) => e.text),
    ).toEqual(["Priorytet: ważny → pilny.", "Priorytet: pilny → zwykły."]);
  });

  it("lists a priority an older writer dropped, from the history", async () => {
    // Written back by code from before priorities: no field, the history kept.
    stored("leak", {
      log: [
        {
          at: at("2026-09-28T09:00:00Z"),
          by: "owner",
          text: "Priorytet: zwykły → pilny.",
        },
      ],
    });
    const { tasks } = await call(listHandler);
    expect(tasks).toEqual([
      expect.objectContaining({ priority: "urgent", prioritySetBy: "owner" }),
    ]);
  });
});
