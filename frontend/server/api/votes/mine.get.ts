import { z } from "zod";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { ownVotesPg } from "~~/server/db/votes";

const queryValidator = z.object({
  kind: z.enum(["node", "extraction"]).default("node"),
  /** Comma separated target ids; without it, every vote of the kind. */
  targets: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : [...new Set(value.split(",").filter(Boolean))],
    )
    .refine((ids) => !ids || ids.length <= 300, "Zbyt wiele celów naraz."),
});

/** The reader's own votes, by target, for the vote buttons and the review
 * page (decision on 2026-11-26: no listeners). */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const { kind, targets } = await getValidatedQuery(event, (q) =>
    queryValidator.parse(q),
  );
  if (targets && targets.length === 0) return { votes: {} };
  const votes = await ownVotesPg(user.uid, kind, targets);
  return { votes };
});
