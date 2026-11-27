import { z } from "zod";
import { documentId } from "~~/server/utils/requestIds";

/** The furthest ring `/api/graph/local/[id]` draws. The graph offers one and
 * two hops, and every hop past the second multiplies both the fetch and what
 * lands on the canvas. The POST took any number until 2026-11-26, so a single
 * request could walk the graph hop after hop for as long as new nodes kept
 * turning up. */
export const MAX_GRAPH_DISTANCE = 3;

/** How many ids one `expand` or `subjects` list may hold. The table sends the
 * other rows of a page, 99 at most; each id is a focus node read in full on
 * the first hop, which `FRONTIER_LIMIT` does not bound. */
export const MAX_GRAPH_IDS = 200;

/** Clamped rather than refused, as the GET always did: a missing or zero
 * distance is one hop, and anything past the ceiling is the ceiling. */
export const graphDistance = z.coerce
  .number()
  .int()
  .optional()
  .transform((distance) =>
    Math.min(Math.max(distance || 1, 1), MAX_GRAPH_DISTANCE),
  );

/** A comma-separated string or an array of ids, as a list of non-blank ids. */
export const graphIdList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) =>
    (typeof value === "string" ? value.split(",") : (value ?? []))
      .map((id) => id.trim())
      .filter(Boolean),
  )
  .pipe(z.array(documentId).max(MAX_GRAPH_IDS));
