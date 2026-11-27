import { useDb } from "./client";
import { textArray } from "./textArray";

/** One person's own record on /profil (server/utils/myVotes.ts) in SQL. */

export type VoteRow = {
  nodeId: unknown;
  updatedAt: unknown;
  categoryVotes: unknown;
};

/** Up to `cap` of one user's votes on pages, newest first, then by page:
 * a vote without a `nodeId` (one on a fact) or an `updatedAt` is not one of
 * them (`votes_user_time`). */
export function scanMyVotesPg(uid: string, cap: number): Promise<VoteRow[]> {
  return useDb()<VoteRow[]>`
    SELECT data -> 'nodeId' AS "nodeId", data -> 'updatedAt' AS "updatedAt",
      data -> 'categoryVotes' AS "categoryVotes"
    FROM votes
    WHERE user_uid = ${uid} AND data ? 'nodeId' AND data ? 'updatedAt'
    ORDER BY jsonb_typeof(data -> 'updatedAt') = 'string' DESC,
      (data ->> 'updatedAt') COLLATE "C" DESC,
      (data ->> 'nodeId') COLLATE "C", id
    LIMIT ${cap}`;
}

/** The name and type of each page of `ids` that exists. */
export async function pageNamesPg(
  ids: readonly string[],
): Promise<Map<string, { name: unknown; type: unknown }>> {
  if (ids.length === 0) return new Map();
  const rows = await useDb()<{ id: string; name: unknown; type: unknown }[]>`
    SELECT id, data -> 'name' AS name, data -> 'type' AS type FROM nodes
    WHERE id = ANY(${textArray([...ids])}::text[])`;
  return new Map(rows.map(({ id, name, type }) => [id, { name, type }]));
}
