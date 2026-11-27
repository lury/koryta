import { pageNamesPg, scanMyVotesPg } from "~~/server/db/interactions";
import { generateEntityUrl } from "~~/shared/slugs";
import { nodeTypes, type NodeType } from "~~/shared/model";

/** How many of one user's votes are read. The most votes on people any account
 * had on 2026-11-20 was 746, and the median voter 3. */
export const VOTES_SCAN_CAP = 1000;

/** A vote on a person, as /profil lists it: who, and what was said about
 * them in the „interesting” category. */
export type MyVote = {
  nodeId: string;
  /** Null once the page is gone. */
  name: string | null;
  /** The page to open, or null when there is none to link to. */
  path: string | null;
  value: number;
  updatedAt: string;
};

export type ScannedVote = Pick<MyVote, "nodeId" | "value" | "updatedAt">;

/**
 * The pages one user voted on in the „interesting” category, newest vote
 * first.
 *
 * One scan on `votes_user_time`. A vote on an extracted fact carries an
 * `extractionId` instead of a `nodeId`, so it is not read. A vote taken back
 * is stored as zero, so it is not a vote.
 */
export async function scanMyVotes(
  uid: string,
): Promise<{ votes: ScannedVote[]; truncated: boolean }> {
  const rows = await scanMyVotesPg(uid, VOTES_SCAN_CAP);
  const votes = rows.flatMap(({ nodeId, updatedAt, categoryVotes }) => {
    const value = (categoryVotes as { interesting?: unknown } | null)
      ?.interesting;
    return typeof nodeId === "string" &&
      typeof updatedAt === "string" &&
      typeof value === "number" &&
      value !== 0
      ? [{ nodeId, updatedAt, value }]
      : [];
  });
  return { votes, truncated: rows.length >= VOTES_SCAN_CAP };
}

/** The names and pages of the people voted on, read for the rows a page
 * shows rather than for every vote scanned. */
export async function nameVotes(votes: ScannedVote[]): Promise<MyVote[]> {
  const pages = await pageNamesPg([
    ...new Set(votes.map((vote) => vote.nodeId)),
  ]);

  return votes.map((vote) => {
    const page = pages.get(vote.nodeId);
    const name = page ? stringOrNull(page.name) : null;
    const type = page ? nodeTypeOrNull(page.type) : null;
    return {
      ...vote,
      name,
      path: type && name ? generateEntityUrl(type, vote.nodeId, name) : null,
    };
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nodeTypeOrNull(value: unknown): NodeType | null {
  return typeof value === "string" &&
    (nodeTypes as readonly string[]).includes(value)
    ? (value as NodeType)
    : null;
}
