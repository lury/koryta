import type { ExtractionFact } from "~~/shared/model";

/** An extraction document as the shared model has it: `createdAt` travels as
 * an ISO string (as Postgres stores it), and the review state is read off
 * the vote aggregate that a vote's write keeps on the document
 * (server/db/votes.ts), so it costs no read of the votes collection. */
export function toExtractionFact(
  id: string,
  doc: Record<string, unknown>,
): ExtractionFact {
  const { createdAt, stats, ...data } = doc;
  const votes = (stats as { votes?: { humanVoted?: unknown } } | undefined)
    ?.votes;
  return {
    id,
    ...data,
    stats,
    createdAt,
    // One reviewer per fact: a human (not the pipeline) has judged this one.
    reviewed: votes?.humanVoted === true,
  } as ExtractionFact;
}
