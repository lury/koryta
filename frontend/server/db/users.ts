import { textArray } from "./textArray";
import { useDb } from "./client";
import { mergeMe, type MePatch } from "../utils/meRules";
import { userDocumentSchema } from "../../shared/documents";
import { normalizeUpdateTime } from "../../shared/revisions";

/** `users/{uid}` on Postgres, for its owner. */

/** The settings as the API answers them: `newsletterUpdated.at` as ISO, as
 * a document imported from Firestore may hold it in another shape. */
export function servedMe(
  data: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!data) return null;
  const update = data.newsletterUpdated as { at?: unknown } | undefined;
  if (!update) return data;
  return {
    ...data,
    newsletterUpdated: { ...update, at: normalizeUpdateTime(update.at) },
  };
}

export async function readMePg(
  uid: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await useDb()<{ data: Record<string, unknown> }[]>`
    SELECT data FROM users WHERE id = ${uid}`;
  return row?.data ?? null;
}

export async function patchMePg(
  uid: string,
  patch: MePatch,
): Promise<Record<string, unknown>> {
  return useDb().begin(async (tx) => {
    const [row] = await tx<{ data: Record<string, unknown> }[]>`
      SELECT data FROM users WHERE id = ${uid} FOR UPDATE`;
    const next = mergeMe(row?.data ?? null, patch, new Date().toISOString());
    userDocumentSchema.parse(next);
    await tx`
      INSERT INTO users (id, data) VALUES (${uid}, ${tx.json(next as never)})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    return next;
  });
}

/** `readPublicProfiles` (server/utils/contributors.ts) on Postgres. */
export async function readPublicProfilesPg(
  uids: string[],
): Promise<Record<string, boolean>> {
  if (uids.length === 0) return {};
  const sql = useDb();
  const rows = await sql<{ id: string; public: boolean }[]>`
    SELECT id, coalesce(jsonb_is_true(data -> 'publicProfile'), false) AS public
    FROM users WHERE id = ANY(${textArray(uids)}::text[])`;
  const found = Object.fromEntries(rows.map((r) => [r.id, r.public]));
  return Object.fromEntries(uids.map((uid) => [uid, found[uid] === true]));
}
