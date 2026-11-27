import { z } from "zod";
import { getOptionalUser } from "~~/server/utils/auth";
import { nodeOptions } from "~~/server/db/nodes";

const queryValidator = z.object({
  type: z.enum(["article", "topic"]),
  /** Part of a name, two characters at least. */
  q: z.string().max(200).optional(),
  /** Part of an article's link, three characters at least; several are
   * spellings of one link, any of which may match. */
  url: z
    .union([z.string().max(500), z.array(z.string().max(500)).max(4)])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : Array.isArray(value) ? value : [value],
    ),
});

/** The articles or topics a picker offers: those whose name, or for an
 * article whose link, holds what the reader typed, never more than
 * NODE_OPTIONS_LIMIT (server/db/nodes.ts). The pickers listed every article
 * (`/api/nodes?type=article`) and filtered them in the browser, which grows
 * with the base: 46 thousand at x50. Drafts for a signed in reader only. */
export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const user = await getOptionalUser(event);
  return nodeOptions({
    type: query.type,
    q: query.q,
    url: query.url,
    showDrafts: !!user,
  });
});
