/**
 * An admin's decisions on crops and held pages, and what a publication by
 * hand does to a hold, on Postgres: the rules of
 * server/utils/declarationDecisions.ts, each decision one transaction under
 * the row lock of the crop or the record it decides.
 */
import { createError } from "h3";
import { readingKind, type ExtractStatus } from "../../shared/declarations";
import {
  isDeclined,
  waitsForAdmin,
  type AdminDecision,
  type DecidedExtract,
} from "../utils/declarationDecisions";
import type { StoredPublication } from "../utils/declarationRules";
import { useDb } from "./client";
import { restageDeclarationPeoplePg } from "./declarationPeopleCount";
import type postgres from "postgres";

type Data = Record<string, unknown>;
type Tx = postgres.TransactionSql;

/** Records of pages read to tell whether a public one links a crop. */
const LINKED_RECORDS = 50;

/** Sets `set` and removes `unset` on a row of `table`, in the transaction. */
async function patch(
  tx: Tx,
  table: "declaration_extracts" | "declaration_publications",
  id: string,
  set: Data,
  unset: string[] = [],
): Promise<void> {
  await tx`
    UPDATE ${tx(table)}
    SET data = (data || ${tx.json(set as never)}::jsonb) - ${`{${unset.join(",")}}`}::text[],
        updated_at = clock_timestamp()
    WHERE id = ${id}`;
}

/** `linkedOnAPage`: whether a published or confirmed record lists the crop.
 * A question that cannot be answered counts as yes. */
export async function linkedOnAPagePg(extractId: string): Promise<boolean> {
  try {
    const sql = useDb();
    const rows = await sql<{ status: unknown }[]>`
      SELECT data -> 'status' AS status FROM declaration_publications
      WHERE data @> ${sql.json({ extractIds: [extractId] })}
      ORDER BY id LIMIT ${LINKED_RECORDS}`;
    return rows.some(
      (row) => row.status === "published" || row.status === "confirmed",
    );
  } catch (error) {
    console.error(
      `[declarations] cannot tell whether a page links ${extractId}`,
      error,
    );
    return true;
  }
}

/** `decideExtract`: an admin's decision on a crop that waits for one. A 404
 * for a crop that does not exist or has nothing to read, a 409 for one that
 * no longer waits for an admin. */
export async function decideExtractPg(args: {
  extractId: string;
  uid: string;
  decision: AdminDecision;
  now?: Date;
}): Promise<DecidedExtract> {
  const now = args.now ?? new Date();
  const { decision } = args;
  const value = decision.verdict === "date" ? decision.value : null;
  const kind = value === null ? null : readingKind(value);
  if (decision.verdict === "date" && !kind) {
    throw createError({
      statusCode: 400,
      message: "Data musi być dniem (RRRR-MM-DD) albo rokiem (RRRR).",
    });
  }
  const status: ExtractStatus =
    decision.verdict === "date"
      ? "agreed"
      : decision.verdict === "unreadable"
        ? "unreadable"
        : "withdrawn";
  let decided: DecidedExtract;
  await useDb().begin(async (tx) => {
    const [row] = await tx<{ data: Data }[]>`
      SELECT data FROM declaration_extracts WHERE id = ${args.extractId} FOR UPDATE`;
    const data = row?.data;
    if (!data || data.status === "failed") {
      throw createError({
        statusCode: 404,
        message: "Nie ma takiego wycinka.",
      });
    }
    if (data.status === "open") {
      throw createError({
        statusCode: 409,
        message: "Ten wycinek czeka jeszcze na czytelników.",
      });
    }
    if (!waitsForAdmin(data)) {
      throw createError({
        statusCode: 409,
        message: "Ten wycinek ktoś już rozstrzygnął.",
      });
    }
    const at = now.toISOString();
    await patch(tx, "declaration_extracts", args.extractId, {
      status,
      agreed: kind ? { value, kind, by: "admin", uid: args.uid, at } : null,
      decision: {
        verdict: decision.verdict,
        value,
        uid: args.uid,
        at,
        before: {
          status: data.status,
          agreed:
            ((data.agreed as { value?: string } | null)?.value as
              string | undefined) ?? null,
        },
      },
      pageMatch: null,
      pageRecheck: false,
      updatedAt: at,
    });
    decided = { id: args.extractId, status, compare: kind === "date" };
  });
  return decided!;
}

/** A held page's record under its lock, refused with a 404 when there is
 * none and a 409 when it is not in the state the decision starts from. */
async function decideRecord(
  pageId: string,
  accepts: (record: StoredPublication) => boolean,
  refusal: string | ((record: StoredPublication) => string),
  set: Data,
  unset: string[] = [],
): Promise<void> {
  await useDb().begin(async (tx) => {
    const [row] = await tx<{ data: StoredPublication }[]>`
      SELECT data FROM declaration_publications WHERE id = ${pageId} FOR UPDATE`;
    const record = row?.data;
    if (!record) {
      throw createError({
        statusCode: 404,
        message: "Nie ma takiej publikacji.",
      });
    }
    if (!accepts(record)) {
      throw createError({
        statusCode: 409,
        message: typeof refusal === "string" ? refusal : refusal(record),
      });
    }
    await patch(tx, "declaration_publications", pageId, set, unset);
  });
}

/** `declinePublication`: an admin's „Nie publikuj” on a held page. */
export async function declinePublicationPg(
  pageId: string,
  uid: string,
  now: Date = new Date(),
): Promise<void> {
  const at = now.toISOString();
  await decideRecord(
    pageId,
    (record) => record.status === "held" && !record.declinedAt,
    (record) =>
      isDeclined(record)
        ? "Ta osoba jest już odłożona."
        : "Ta publikacja nie jest już wstrzymana.",
    { declinedBy: uid, declinedAt: at, updatedAt: at },
  );
}

/** `restorePublication`: takes a „Nie publikuj” back. */
export async function restorePublicationPg(
  pageId: string,
  now: Date = new Date(),
): Promise<void> {
  await decideRecord(
    pageId,
    isDeclined,
    "Tej publikacji nikt już nie odkłada.",
    { updatedAt: now.toISOString() },
    ["declinedBy", "declinedAt"],
  );
}

/** `closeHoldOnPublication`: a held record of a page published by hand
 * becomes `published`, by hand. Whether a hold was closed. */
async function closeHoldOnPublication(
  pageId: string,
  uid: string,
  now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const rows = await useDb()`
    UPDATE declaration_publications
    SET data = (data || jsonb_build_object(
          'status', 'published', 'reason', null, 'publishedAt', ${at}::text,
          'autoPublished', false, 'updatedAt', ${at}::text,
          'handPublished', jsonb_build_object(
            'uid', ${uid}::text, 'at', ${at}::text,
            'held', coalesce(data -> 'reason', 'null'::jsonb))))
        - '{declinedBy,declinedAt,day}'::text[],
        updated_at = clock_timestamp()
    WHERE id = ${pageId} AND data -> 'status' = '"held"'::jsonb
    RETURNING id`;
  return rows.length > 0;
}

/** `reopenHoldOnUnpublication`: the hold a publication by hand closed is
 * put back on a page taken down again. Whether it was. */
async function reopenHoldOnUnpublication(
  pageId: string,
  now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const rows = await useDb()`
    UPDATE declaration_publications
    SET data = (data || jsonb_build_object(
          'status', 'held', 'heldAt', ${at}::text, 'updatedAt', ${at}::text,
          'reason', CASE WHEN jsonb_typeof(data #> '{handPublished,held}') = 'string'
                         THEN data #> '{handPublished,held}' ELSE '"kept_hidden"'::jsonb END))
        - '{handPublished,publishedAt}'::text[],
        updated_at = clock_timestamp()
    WHERE id = ${pageId} AND data -> 'status' = '"published"'::jsonb
      AND jsonb_truthy(data -> 'handPublished')
    RETURNING id`;
  return rows.length > 0;
}

/** `afterHandPublication`: after a person's page went public, or back, by
 * hand (/api/nodes/publish, /api/revisions/approve), its hold is closed or
 * put back and the person moves in the people count. Best effort: never
 * throws. */
export async function afterHandPublicationPg(
  pageId: string,
  uid: string,
  published: boolean,
): Promise<void> {
  try {
    const now = new Date();
    const changed = published
      ? await closeHoldOnPublication(pageId, uid, now)
      : await reopenHoldOnUnpublication(pageId, now);
    if (changed) await restageDeclarationPeoplePg([pageId]);
  } catch (error) {
    console.error(
      `[declarations] cannot ${published ? "close" : "reopen"} the hold of ${pageId}`,
      error,
    );
  }
}
