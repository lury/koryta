import { textArray } from "./textArray";
import type { TransactionSql } from "postgres";
import { useDb } from "./client";
import { refreshNodeStats } from "./writeEffects";
import { computeVoteStats } from "../../shared/stats";
import type { VoteDocument } from "../../shared/model";
import {
  OWN_VOTES_CAP,
  isOwnStoredVote,
  mergeVote,
  voteDocId,
  type OwnVotes,
  type PipelineVotesBody,
  type VoteBody,
  type VoteKind,
} from "../utils/voteRules";

/** Votes on Postgres: what the browser wrote to Firestore and the
 * onVoteWritten trigger aggregated. A node's `stats.votes` comes from
 * node_stats, refreshed after the write; an extraction has no view, so its
 * `stats.votes` is rewritten in the same transaction, as the trigger did. */

type Tx = TransactionSql;

async function storedVote(tx: Tx, id: string): Promise<VoteDocument | null> {
  const [row] = await tx<{ data: VoteDocument }[]>`
    SELECT data FROM votes WHERE id = ${id} FOR UPDATE`;
  return row?.data ?? null;
}

async function upsertVote(tx: Tx, id: string, data: VoteDocument) {
  await tx`
    INSERT INTO votes (id, data) VALUES (${id}, ${tx.json(data as never)})
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
}

/** onVoteWritten for an extraction: every vote on it, summed again. */
async function recountExtraction(tx: Tx, extractionId: string) {
  const votes = await tx<{ data: VoteDocument }[]>`
    SELECT data FROM votes WHERE extraction_id = ${extractionId}`;
  const stats = computeVoteStats(votes.map((v) => v.data));
  await tx`
    UPDATE extractions SET data = jsonb_set(data, '{stats}',
      coalesce(data -> 'stats', '{}') || jsonb_build_object('votes', ${tx.json(stats as never)}::jsonb)),
      updated_at = now()
    WHERE id = ${extractionId}`;
}

export async function putOwnVotePg(
  targetId: string,
  uid: string,
  body: VoteBody,
): Promise<VoteDocument> {
  const id = voteDocId(targetId, uid);
  const merged = await useDb().begin(async (tx) => {
    const vote = mergeVote(await storedVote(tx, id), {
      targetId,
      uid,
      body,
      now: new Date().toISOString(),
    });
    await upsertVote(tx, id, vote);
    if (body.kind === "extraction") await recountExtraction(tx, targetId);
    else await refreshNodeStats(tx, [targetId]);
    return vote;
  });
  return merged;
}

/** Whether there was a vote of this person's to delete. */
export async function deleteOwnVotePg(
  targetId: string,
  uid: string,
): Promise<"deleted" | "missing" | "forbidden"> {
  const id = voteDocId(targetId, uid);
  const outcome = await useDb().begin(async (tx) => {
    const stored = await storedVote(tx, id);
    if (!stored) return "missing" as const;
    if (!isOwnStoredVote(stored, targetId, uid)) return "forbidden" as const;
    await tx`DELETE FROM votes WHERE id = ${id}`;
    if (stored.extractionId) await recountExtraction(tx, targetId);
    else await refreshNodeStats(tx, [targetId]);
    return "deleted" as const;
  });
  return outcome;
}

/** This person's votes: on the targets named, or on every target of the
 * kind, newest first, up to OWN_VOTES_CAP. */
export async function ownVotesPg(
  uid: string,
  kind: VoteKind,
  targets?: string[],
): Promise<OwnVotes> {
  const sql = useDb();
  const column = sql(kind === "extraction" ? "extraction_id" : "node_id");
  // By document id when the targets are named, as Firestore's getAll.
  const ids = targets?.map((target) => voteDocId(target, uid)) ?? [];
  const rows = await sql<{ target: string; data: VoteDocument }[]>`
    SELECT ${column} AS target, data FROM votes
    WHERE user_uid = ${uid} AND ${column} IS NOT NULL
      AND (${!targets} OR id = ANY(${textArray(ids)}::text[]))
    ORDER BY data ->> 'updatedAt' DESC NULLS LAST, id
    LIMIT ${OWN_VOTES_CAP}`;
  return Object.fromEntries(
    rows.map(({ target, data }) => [
      target,
      {
        categoryVotes: data.categoryVotes,
        ...(data.comment !== undefined ? { comment: data.comment } : {}),
        ...(data.updatedAt ? { updatedAt: data.updatedAt } : {}),
      },
    ]),
  );
}

/** Node id -> the model's `interesting`, for the pipelines' reconciliation. */
export async function pipelineScoresPg(
  model: string,
): Promise<Record<string, number>> {
  const rows = await useDb()<{ node_id: string; score: number }[]>`
    SELECT node_id, (data -> 'categoryVotes' ->> 'interesting')::float8 AS score
    FROM votes
    WHERE user_uid = ${model} AND node_id IS NOT NULL
      AND jsonb_typeof(data -> 'categoryVotes' -> 'interesting') = 'number'`;
  return Object.fromEntries(rows.map((r) => [r.node_id, r.score]));
}

/** Sets and retracts a model's scores in one transaction. Only the
 * `interesting` leaf is set, as the REST upload's update mask did, so another
 * category on the same vote stays. */
export async function applyPipelineVotesPg(
  body: PipelineVotesBody,
): Promise<{ written: number; retracted: number }> {
  const { model } = body;
  const rows = body.set.map(({ nodeId, score }) => ({
    id: voteDocId(nodeId, model),
    data: { nodeId, userUid: model, categoryVotes: { interesting: score } },
  }));
  const stale = body.retract.map((nodeId) => voteDocId(nodeId, model));
  const result = await useDb().begin(async (tx) => {
    if (rows.length > 0) {
      await tx`
        INSERT INTO votes (id, data)
        SELECT x.id, x.data
        FROM jsonb_to_recordset(${tx.json(rows as never)}) AS x(id text, data jsonb)
        ON CONFLICT (id) DO UPDATE SET
          data = votes.data || jsonb_build_object(
            'nodeId', EXCLUDED.data -> 'nodeId',
            'userUid', EXCLUDED.data -> 'userUid',
            'categoryVotes', coalesce(votes.data -> 'categoryVotes', '{}')
              || (EXCLUDED.data -> 'categoryVotes')),
          updated_at = now()`;
    }
    const deleted =
      stale.length > 0
        ? await tx`DELETE FROM votes WHERE id = ANY(${textArray(stale)}::text[])`
        : { count: 0 };
    await refreshNodeStats(tx, [
      ...body.set.map(({ nodeId }) => nodeId),
      ...body.retract,
    ]);
    return { written: rows.length, retracted: deleted.count };
  });
  return result;
}
