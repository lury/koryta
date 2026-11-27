import type { DecodedIdToken } from "firebase-admin/auth";
import type { H3Event } from "h3";
import { READER_ID_PATTERN, type Settlement } from "~~/shared/declarations";
import { getUser } from "./auth";

/** Who reads the crops and what an answer of theirs is: the rules the
 * Postgres reads and writes of server/db/declarationReading.ts keep. */

export const EXTRACTS = "declarationExtracts";
export const EXTRACT_IMAGES = "declarationExtractImages";
export const ANSWERS = "declarationAnswers";
export const READER_LIMITS = "declarationReaderLimits";
export const PUBLICATIONS = "declarationPublications";
export const PUBLISH_LIMITS = "declarationPublishLimits";
/** One record a reader and a person they found: the reader typed a date off
 * one of the person's crops that the birth date on the person's page does not
 * contradict (`creditFinds` in server/db/declarationPublish.ts). Server-only, like the
 * answers. */
export const READER_FINDS = "declarationReaderFinds";

/** Answers one reader may give in a Warsaw day. Far above what a person reads
 * in a sitting (the 10-29 review read 145 crops in an afternoon), low enough
 * that one account cannot read the whole queue alone. A browser without an
 * account is held to it too, under its reader id, and the answers an account
 * claims count on it for the days they were given (`claimAnswers`). */
export const READER_DAILY_LIMIT = 300;

/** Answers all readers without a vote may give in a Warsaw day, between them,
 * skips included: what ten readers may read in a day. A reader id costs
 * nothing to make, and an account nobody confirmed costs one sign-up, so the
 * limit per reader bounds nothing here; this bounds what they can write. Past
 * it, reading goes on with an account that votes. */
export const VOTELESS_DAILY_LIMIT = 3000;

/** Times all readers without a vote may ask for crops in a Warsaw day,
 * between them: four to every answer they may give. A sitting asks once or
 * twice, as every answer brings the next crops with it; what this bounds is a
 * stranger asking without answering, a fresh reader id each time, when every
 * ask reads a page of crops and this reader's answers to them. */
export const VOTELESS_ASK_DAILY_LIMIT = 4 * VOTELESS_DAILY_LIMIT;

/** Documents a day's room for readers without a vote is kept on, each with
 * its share of it. On one document every stranger's answer would wait for the
 * one before it; on ten, only those that land on the same one do. */
export const ROOM_SHARDS = 10;

/** Answers one claim moves at most: days of reading in one browser, as a
 * reader without an account may give `READER_DAILY_LIMIT` a day, and few
 * enough that the claim stays a request. Past it the rest stay under the
 * browser's id, which the page forgets once the claim succeeds. Nothing that
 * counted is lost: those answers never voted, and the account is served their
 * crops again. */
export const CLAIM_LIMIT = 1000;

/** Whether an account's answers can count towards an agreement.
 *
 * Agreement is counted in distinct accounts, so an account has to be some
 * evidence of a person: a Google sign-in, or an e-mail address its owner
 * confirmed. Sign-up with a password sends the confirmation mail but never
 * requires it (LoginForm.vue), which on its own would let one person make the
 * two readers that publish a page. */
export function isCountedReader(user: DecodedIdToken): boolean {
  return (
    user.email_verified === true ||
    user.firebase.sign_in_provider === "google.com"
  );
}

/** Who answers a crop. */
export type DeclarationReader = {
  /** Whose the answers are: the account's uid, or `anon:<reader id>`. */
  uid: string;
  /** Whether the answers count towards an agreement. */
  votes: boolean;
  /** Reading without an account, under the browser's reader id. */
  anonymous: boolean;
};

/** The uid the answers of a browser without an account are filed under. The
 * prefix keeps it apart from every account's uid. */
export function anonymousUid(readerId: string): string {
  return `anon:${readerId}`;
}

/** A reader id as a browser sent it, lower-cased, or null for anything but a
 * version 4 UUID. */
export function readerIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.toLowerCase();
  return READER_ID_PATTERN.test(id) ? id : null;
}

/**
 * Who is asking for crops or answering one. Reading is open to readers
 * without an account: their answers are kept under their browser's id and
 * count towards no automatic publication.
 *
 * A token makes the reader its account, whose answers vote once it is some
 * evidence of a person (`isCountedReader`); an account without a confirmed
 * address reads all the same, without a vote. Without a token, the browser's
 * reader id (`X-Reader-Id`) files the answers under `anon:<id>`, never with a
 * vote. A token that does not verify is a 401 even beside a reader id: a
 * signed-in reader whose token lapsed must find out, not have their answers
 * filed as a stranger's.
 */
export async function getReader(event: H3Event): Promise<DeclarationReader> {
  if (getRequestHeader(event, "Authorization") !== undefined) {
    const user = await getUser(event);
    return { uid: user.uid, votes: isCountedReader(user), anonymous: false };
  }
  const readerId = readerIdOf(getRequestHeader(event, "X-Reader-Id"));
  if (readerId) {
    return { uid: anonymousUid(readerId), votes: false, anonymous: true };
  }
  throw createError({
    statusCode: 401,
    message:
      "Błąd uwierzytelniania: brak tokenu ani identyfikatora czytelnika. Proszę się zalogować.",
  });
}

/** An answer's document: one per crop and reader, so answering again
 * replaces the earlier answer instead of adding a voice. */
export function answerId(extractId: string, uid: string): string {
  return `${extractId}_${uid}`;
}

export type RecordedAnswer = {
  /** What the answers settle, if this answer settled the crop. */
  settled: Settlement | null;
  /** The person pages the crop is linked to, for crediting the reader with
   * whom a date found (`creditFinds`). */
  personIds: string[];
};

export type ClaimedAnswers = {
  /** Answers that are the account's now. */
  claimed: number;
  /** The crops they settled, and what they settled. */
  settled: { extractId: string; settlement: Settlement }[];
  /** Answers still under the browser's id because their crop's transaction
   * failed, in parallel and then alone: the next claim moves them, so the
   * page has to keep the id. */
  left: number;
};
