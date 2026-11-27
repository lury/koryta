import { z } from "zod";
import { getReader } from "~~/server/utils/declarations";
import { EXTRACT_ID_PATTERN } from "~~/shared/declarations";
import { admitToQueuePg, queueForPg } from "~~/server/db/declarationReading";

/** Crops a request may name as already on the page. The page names none here
 * and at most ten with an answer (`holding`); each one named is a crop the
 * queue reads past, and a list long enough to cover a page of the queue would
 * make every ask read page after page. */
const MAX_EXCLUDED = 10;

const queryValidator = z.object({
  /** Clamped to 1-5 below rather than refused. */
  count: z.coerce.number().int().optional(),
  /** Room for the ten crops a page may name, about 70 characters each, with
   * slack; anything past ten is dropped below. */
  exclude: z.string().max(2000).optional(),
});

/**
 * The crops a reader should read next, for /oswiadczenia: a signed-in reader
 * by their token, one without an account by their browser's reader id
 * (`getReader`). A reader without a vote asks within the day's room for such
 * readers (`admitToQueue`): with no account needed, nothing else stops a
 * stranger asking over and over.
 *
 * `count` (1-5) asks for a few at once, so the page can show the next one
 * the moment an answer is sent; `exclude` names crops the page already holds.
 * Per reader and private, so never cached: a cached answer would hand one
 * reader's queue, and with it which crops they have read, to the next.
 */
export default defineEventHandler(async (event) => {
  const reader = await getReader(event);
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );
  const count = Math.min(5, Math.max(1, query.count || 1));
  const exclude = new Set(
    (query.exclude ?? "")
      .split(",")
      .filter((id) => EXTRACT_ID_PATTERN.test(id))
      .slice(0, MAX_EXCLUDED),
  );

  await admitToQueuePg(reader);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return queueForPg(reader.uid, count, exclude);
});
