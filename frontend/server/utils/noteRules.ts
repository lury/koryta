import { z } from "zod";
import { createError } from "h3";
import type { Note, NoteSource } from "~~/shared/model";

/** What firestore.rules enforced on `notes`, as checks both backends run:
 * one note per page per person at `<nodeId>_<uid>` (`isOwnNote`), written
 * and deleted only by its author, read by signed-in readers, and by anybody
 * else only on a page that is not a person. */

export function noteDocId(nodeId: string, uid: string): string {
  return `${nodeId}_${uid}`;
}

export function assertNoteNode(nodeId: string): void {
  if (!nodeId || nodeId.length > 400 || nodeId.includes("/")) {
    throw createError({ statusCode: 400, message: "Nieprawidłowa strona." });
  }
}

const source = z
  .object({
    url: z.string().max(2000).optional(),
    note: z.string().max(20_000),
    kind: z.enum(["source", "change_request", "missing"]).optional(),
    articleNodeId: z.string().max(400).optional(),
    // Kept as the author's editor hands them back, so a save does not wipe a
    // triage made since the editor opened.
    adminStatus: z.enum(["resolved", "unresolved"]).optional(),
    adminType: z.string().max(100).optional(),
    adminTypeDeferred: z.boolean().optional(),
    declarationExtractId: z.string().max(400).optional(),
  })
  .strict();

export const noteBody = z.object({
  sources: z.array(source).max(200),
});
export type NoteBody = z.infer<typeof noteBody>;

export const articleIdsBody = z.object({
  /** normalizeUrl(url) -> the article node it became. */
  articleIds: z.record(z.string().max(2000), z.string().min(1).max(400)),
});

/** The note after the author's save. `createdAt` is kept from the stored
 * note; `now` is the server's clock, not the browser's. Refused when the
 * stored note at this id is somebody else's (the `update` rule checks both
 * the stored and the incoming note). */
export function mergeNote<T>(
  stored: Note | null,
  input: { nodeId: string; uid: string; body: NoteBody; now: T },
): Omit<Note, "createdAt" | "updatedAt"> & {
  createdAt: T | string;
  updatedAt: T;
} {
  if (stored && stored.userUid !== input.uid) {
    throw createError({
      statusCode: 403,
      message: "To nie jest Twoja notatka.",
    });
  }
  return {
    ...(stored ?? {}),
    userUid: input.uid,
    nodeId: input.nodeId,
    sources: input.body.sources as NoteSource[],
    createdAt: stored?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

/** Admin triage of one entry, applied in place (POST /api/notes/admin). */
export const triageBody = z.object({
  noteId: z.string().min(1),
  sourceIndex: z.number().int().min(0),
  // `undefined` leaves the field untouched, `null`/"" clears it.
  adminStatus: z.enum(["resolved", "unresolved"]).nullable().optional(),
  adminType: z.string().nullable().optional(),
  /** "the phone queue can't classify this one" - see NoteSource. */
  adminTypeDeferred: z.boolean().nullable().optional(),
});
export type TriageBody = z.infer<typeof triageBody>;

export function applyTriage(note: Note, body: TriageBody): NoteSource[] {
  const sources = note.sources ?? [];
  const entry = sources[body.sourceIndex];
  if (!entry) {
    throw createError({ statusCode: 404, message: "Źródło nie istnieje." });
  }
  if (body.adminStatus !== undefined) {
    if (body.adminStatus) entry.adminStatus = body.adminStatus;
    else delete entry.adminStatus;
  }
  if (body.adminType !== undefined) {
    if (body.adminType) {
      entry.adminType = body.adminType;
      // A type answers the question the deferral was asking, whichever view
      // gave it - so the flag never outlives what it was waiting for.
      delete entry.adminTypeDeferred;
    } else {
      delete entry.adminType;
    }
  }
  if (body.adminTypeDeferred !== undefined) {
    if (body.adminTypeDeferred) entry.adminTypeDeferred = true;
    else delete entry.adminTypeDeferred;
  }
  return sources;
}

/** A note as GET /api/notes hands it out: ISO dates, its id. */
export type ServedNote = Note & { id: string };
