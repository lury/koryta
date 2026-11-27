import { z } from "zod";
import { getOptionalUser } from "~~/server/utils/auth";
import { nodeOptions } from "~~/server/db/nodes";

const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) =>
    value === undefined ? undefined : Array.isArray(value) ? value : [value],
  );

const queryValidator = z.object({
  /** Part of a name, two characters at least. */
  q: z.string().max(200).optional(),
  /** Places by id, the ones a filter already names. */
  id: list,
  /** Places by KRS number, for a link minted before employers were keyed on
   * node ids. */
  krs: list,
});

/** The places the employer picker of /eksploruj/tabela offers: a page of
 * them matching what the reader types, and the ones the url names, never
 * more than NODE_OPTIONS_LIMIT (server/db/nodes.ts). The table asked for
 * every place instead, which at 640 thousand of them ran the server out of
 * memory. Drafts for a signed in reader only. */
export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const user = await getOptionalUser(event);
  return nodeOptions({
    type: "place",
    q: query.q,
    ids: query.id,
    krs: query.krs,
    showDrafts: !!user,
  });
});
