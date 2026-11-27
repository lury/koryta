import {
  applyTaskPatch,
  dependencyProblem,
  finishedDecisions,
  newTask,
  taskProblem,
  patchedDependsOn,
  taskFromData,
  taskSlug,
  uniqueTaskId,
} from "~~/shared/tasks";
import type {
  Task,
  TaskActor,
  taskCreateSchema,
  taskPatchSchema,
} from "~~/shared/tasks";
import type { z } from "zod";
import { listTasksPg, storeTasksPg, withTaskListPg } from "../db/ops";

/** The owner's task list (`shared/tasks.ts`), as /admin/zadania reads and
 * changes it, in `ops.tasks`. Times are ISO strings, as `Task` holds them. */

export function fromDoc(id: string, data: Record<string, unknown>): Task {
  return taskFromData(id, data);
}

/** A task as a document. `id` is the row's id, not a field; an unset field
 * is left out. */
export function toDoc(task: Task): Record<string, unknown> {
  const { id: _id, closedAt, picked, ...rest } = task;
  return JSON.parse(
    JSON.stringify({
      ...rest,
      ...(closedAt ? { closedAt } : {}),
      ...(picked ? { picked } : {}),
    }),
  ) as Record<string, unknown>;
}

export async function listTasks(): Promise<Task[]> {
  return (await listTasksPg()).map(({ id, data }) => fromDoc(id, data));
}

/** Refused with the reason in words, which the page shows as it is. */
const refuse = (message: string, statusCode = 400) =>
  createError({ statusCode, message });

export async function createTask(
  input: z.output<typeof taskCreateSchema>,
  by: TaskActor,
): Promise<Task> {
  // The id and the dependencies are judged against the list as it is when
  // the task is written.
  return withTaskListPg(async (rows, tx) => {
    const tasks = rows.map(({ id, data }) => fromDoc(id, data));
    const taken = new Set(tasks.map((task) => task.id));
    if (input.id && taken.has(input.id)) {
      throw refuse(`Jest już zadanie ${input.id}.`, 409);
    }
    const id = input.id ?? uniqueTaskId(taskSlug(input.title), taken);
    const problem = dependencyProblem(tasks, id, input.dependsOn);
    if (problem) throw refuse(problem);
    const task = newTask(input, id, by, new Date().toISOString());
    const invalid = taskProblem(task);
    if (invalid) throw refuse(invalid);
    if (
      !(await storeTasksPg(tx, [{ id, data: toDoc(task) }], { create: true }))
    )
      throw refuse(`Jest już zadanie ${id}.`, 409);
    return task;
  });
}

/** Changes a task, and closes the decisions the change finishes (see
 * `finishedDecisions`): `also` are those, as written. */
export async function updateTask(
  id: string,
  patch: z.output<typeof taskPatchSchema>,
  by: TaskActor,
): Promise<{ task: Task; also: Task[] }> {
  return withTaskListPg(async (rows, tx) => {
    const tasks = rows.map(({ id, data }) => fromDoc(id, data));
    const current = tasks.find((task) => task.id === id);
    if (!current) throw refuse(`Nie ma zadania ${id}.`, 404);
    const problem = dependencyProblem(
      tasks,
      id,
      patchedDependsOn(current.dependsOn, patch),
      current.dependsOn,
    );
    if (problem) throw refuse(problem);
    const now = new Date().toISOString();
    const { task } = applyTaskPatch(current, patch, by, now);
    const invalid = taskProblem(task);
    if (invalid) throw refuse(invalid);
    const after = tasks.map((t) => (t.id === id ? task : t));
    const also = finishedDecisions(after, by, now);
    await storeTasksPg(
      tx,
      [task, ...also].map((t) => ({ id: t.id, data: toDoc(t) })),
    );
    return { task, also };
  });
}
