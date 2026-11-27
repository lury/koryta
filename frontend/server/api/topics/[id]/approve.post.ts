import { z } from "zod";
import { requireAdmin } from "~~/server/utils/auth";
import { editorialTx, readDoc, type Data } from "~~/server/db/editorial";
import {
  applyRevisionPg,
  edgeRevisionsForManyPg,
  publishEdgePg,
} from "~~/server/db/revisionWrites";
import { textArray } from "~~/server/db/textArray";
import { approvedRevisionId, pageIsPublic } from "~~/shared/model";
import type { Revision } from "~~/shared/model";

const bodyValidator = z.object({
  /** `tagged` edges to put live alongside the topic. */
  edgeIds: z.array(z.string().min(1)).max(50).optional(),
});

/** Puts a story, and the tags that put articles in it, on the site.
 *
 * One call because it is one decision, and because the steps only work in this
 * order. A tag is an edge, and no edge may be published while an end of it is a
 * draft - so `/api/edges/unpublished` skipped every tag pointing at a topic
 * nobody had approved yet, and the queue that is supposed to surface the work
 * held it back instead. Doing it from the client would have meant three
 * requests in a fixed sequence with two chances to leave the pair half done.
 *
 * The topic itself needs both halves: a node cannot go live without an approved
 * revision, and a topic somebody proposed has only a pending one.
 */
export default defineEventHandler(async (event) => {
  const topicId = getRouterParam(event, "id");
  if (!topicId) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }

  const body = await readValidatedBody(event, (b) => bodyValidator.parse(b));
  const user = await requireAdmin(event);
  return editorialTx(async (tx, log) => {
    const topic = await readDoc(tx, "nodes", topicId, true);
    if (topic?.type !== "topic") {
      throw createError({ statusCode: 404, message: "Nie ma takiego tematu." });
    }

    // 1. The topic. Approving its newest pending revision is what gives it the
    //    `revision_id` without which it may not be published at all.
    if (!approvedRevisionId(topic.revision_id) || !pageIsPublic(topic)) {
      const pending = await tx<{ id: string; data: Revision }[]>`
      SELECT id, data FROM revisions
      WHERE node_id = ${topicId} AND data -> 'node_id' = to_jsonb(${topicId}::text)
      ORDER BY update_time DESC NULLS LAST, id DESC LIMIT 10`;

      const candidate = pending.find((row) => row.data.status !== "rejected");
      if (!candidate) {
        throw createError({
          statusCode: 422,
          message: "Temat nie ma rewizji, którą można zatwierdzić.",
        });
      }

      await applyRevisionPg(tx, log, candidate.id, candidate.data, user, true);
    }

    // 2. The tags. Now that the topic is live both ends of each are, so the rule
    //    holds, and `publishEdgeInBatch` approves the revision each tag already
    //    holds. A proposal to change one stays pending for a reviewer.
    const edgeIds = Array.from(new Set(body.edgeIds ?? []));
    if (edgeIds.length === 0) return { topicId, published: true, tags: 0 };

    const rows = await tx<{ id: string; data: Data }[]>`
    SELECT id, data FROM edges WHERE id = ANY(${textArray(edgeIds)}::text[])
    FOR UPDATE`;
    const byId = new Map(rows.map((row) => [row.id, row.data]));
    const candidates = await edgeRevisionsForManyPg(tx, edgeIds);

    let published = 0;
    for (const id of edgeIds) {
      const stored = byId.get(id);
      // Only tags of *this* topic, so a mistyped id cannot publish some unrelated
      // relation on an admin's behalf.
      if (stored?.type !== "tagged") continue;
      if (stored.target !== topicId || stored.deleted === true) continue;

      await publishEdgePg(tx, log, id, stored, candidates.get(id) ?? [], user);
      published += 1;
    }

    return { topicId, published: true, tags: published };
  });
});
