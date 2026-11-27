import { z } from "zod";
import { createError } from "h3";
import { qaCheckId, type QaCheck } from "~~/shared/qa";
import { useDb } from "~~/server/db/client";
import { qaCheckDocumentSchema } from "~~/shared/documents";

/** Verdicts on the QA changelog (`qaChecks`). The rules: read by anybody
 * signed in, written only as yourself at `<itemId>_<uid>`, never deleted. A
 * verdict is changed by writing the other status. */

export const qaCheckBody = z.object({
  status: z.enum(["ok", "issue"]),
  feedback: z.string().trim().max(4000).default(""),
});
export type QaCheckBody = z.infer<typeof qaCheckBody>;

export function assertQaItem(itemId: string): void {
  if (!itemId || itemId.length > 200 || itemId.includes("/")) {
    throw createError({ statusCode: 400, message: "Nieprawidłowy wpis." });
  }
}

function checkOf<At>(
  stored: QaCheck | null,
  input: { itemId: string; uid: string; body: QaCheckBody; now: At },
) {
  return {
    ...(stored ?? {}),
    itemId: input.itemId,
    userUid: input.uid,
    status: input.body.status,
    feedback: input.body.feedback,
    createdAt: stored?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

/** Every verdict there is. The collection holds one per reader per entry. */
export async function listQaChecks(): Promise<QaCheck[]> {
  const rows = await useDb()<{ data: QaCheck }[]>`
    SELECT data FROM qa_checks ORDER BY id`;
  return rows.map((r) => r.data);
}

export async function putQaCheck(
  itemId: string,
  uid: string,
  body: QaCheckBody,
): Promise<QaCheck> {
  const id = qaCheckId(itemId, uid);
  return useDb().begin(async (tx) => {
    const [row] = await tx<{ data: QaCheck }[]>`
      SELECT data FROM qa_checks WHERE id = ${id} FOR UPDATE`;
    const check = checkOf(row?.data ?? null, {
      itemId,
      uid,
      body,
      now: new Date().toISOString(),
    }) as QaCheck;
    qaCheckDocumentSchema.parse(check);
    await tx`
      INSERT INTO qa_checks (id, data) VALUES (${id}, ${tx.json(check as never)})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    return check;
  });
}
