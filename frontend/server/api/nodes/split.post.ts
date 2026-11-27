import { requireAdmin } from "~~/server/utils/auth";
import {
  countDispositions,
  planEdgeMoves,
  type MergeEdgePlan,
  type MergeDisposition,
} from "~~/server/utils/merge";
import {
  editorialTx,
  patchDoc,
  readDoc,
  recordAuditPg,
} from "~~/server/db/editorial";
import { newDocId } from "~~/server/db/ids";
import { createRevisionPg } from "~~/server/db/revisionWrites";
import {
  edgeDoc,
  edgesTouchingPg,
  repointEdgePg,
  resolveMergedNodePg,
} from "~~/server/db/nodeMerge";
import { personEditSchema } from "~~/shared/api";
import { z } from "zod";

const bodyValidator = z.object({
  /** The page that turned out to be two people. */
  node_id: z.string().min(1),
  reason: z.string().trim().min(1, "Powód rozdzielenia jest wymagany"),
  /** Record that this page is two people and stop there. What separates them
   * is a judgement about individual relations, and the person who can make it
   * is not always the person who noticed. */
  mark_only: z.boolean().optional(),
  /** The relations that belong to the *other* person. Everything not listed
   * stays where it is, which is the safe default: a relation nobody has
   * attributed is still attributed to the page it was found on. */
  edge_ids: z.array(z.string().min(1)).optional(),
  /** Where those relations go. Either a page an admin has already made by hand
   * - the usual case, because noticing the collapse and creating the second
   * person is one sitting - or a new one described here. */
  into_id: z.string().min(1).optional(),
  into_person: personEditSchema
    .partial()
    .extend({ name: z.string().min(1) })
    .optional(),
  dry_run: z.boolean().optional(),
});

export type NodeSplit = {
  node_id: string;
  /** The page the selected relations went to, created if it had to be. */
  into_id?: string;
  created_into: boolean;
  edges: MergeEdgePlan[];
  counts: Record<MergeDisposition, number>;
  marked: boolean;
  applied: boolean;
};

/** Takes one page apart into the two people it was all along.
 *
 * The mirror image of `/api/nodes/merge`, and the harder direction. A merge can
 * be justified from what is stored - two pages carrying one `rejestrIo` are one
 * person, and nothing else has to be decided. A split cannot: relations carry
 * no record of which register entry they were read off, so no query can say
 * that this post belongs to the Michał Nowak born in 1961 and that candidacy to
 * the one born in 1972. Only a person can, which is why this endpoint asks for
 * the list rather than working it out.
 *
 * Hence `mark_only`. Noticing that a page is two people takes a moment; telling
 * their forty relations apart takes an afternoon, and the two rarely happen
 * together. A marked page keeps a note of who said so and why until somebody
 * gets to it.
 *
 * Everything not listed in `edge_ids` stays put. That is deliberate: a relation
 * nobody has attributed is still evidence about the page it was found on, and
 * leaving it is recoverable in a way that moving it on a guess is not.
 */
export default defineEventHandler(async (event): Promise<NodeSplit> => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const user = await requireAdmin(event);
  const split = await editorialTx(async (tx, log): Promise<NodeSplit> => {
    const node = await readDoc(tx, "nodes", body.node_id, true);
    if (!node) {
      throw createError({
        statusCode: 404,
        message: `Nie ma strony o id: ${body.node_id}`,
      });
    }
    if (typeof node.merged_into === "string") {
      throw createError({
        statusCode: 400,
        message:
          `Strona ${body.node_id} została scalona z ` +
          `${node.merged_into}; rozdzielaj tę, która została.`,
      });
    }

    if (body.mark_only) {
      if (!body.dry_run) {
        await patchDoc(tx, log, "nodes", body.node_id, {
          needs_split: {
            reason: body.reason,
            at: new Date().toISOString(),
            user: user.uid,
          },
        });
        await recordAuditPg(tx, {
          action: "split",
          collection: "nodes",
          target_id: body.node_id,
          user: user.uid,
          reason: body.reason,
        });
      }
      return {
        node_id: body.node_id,
        created_into: false,
        edges: [],
        counts: countDispositions([]),
        marked: true,
        applied: !body.dry_run,
      };
    }

    if (!body.into_id && !body.into_person) {
      throw createError({
        statusCode: 400,
        message:
          "Podaj stronę, na którą przenieść powiązania, albo dane nowej osoby.",
      });
    }
    if (body.into_id && body.into_person) {
      throw createError({
        statusCode: 400,
        message:
          "Podaj albo istniejącą stronę, albo dane nowej - nie oba naraz.",
      });
    }

    const edgeIds = body.edge_ids ?? [];
    // Checked against this page rather than trusted: an id from a stale dialog
    // could name a relation that has since moved, and re-pointing that one
    // would take a fact off a third page.
    const touching = await edgesTouchingPg(tx, body.node_id, true);
    const byId = new Map(touching.map((row) => [row.id, row]));
    const missing = edgeIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw createError({
        statusCode: 400,
        message: `Te powiązania nie należą już do tej strony: ${missing.join(", ")}`,
      });
    }
    const moving = edgeIds.map((id) => byId.get(id)!);

    // An existing destination is resolved through its own merges first, so
    // splitting onto a page that was merged away lands where a reader would.
    const destination = body.into_id
      ? await resolveMergedNodePg(tx, body.into_id)
      : undefined;
    if (body.into_id && !destination?.data) {
      throw createError({
        statusCode: 404,
        message: `Nie ma strony o id: ${body.into_id}`,
      });
    }
    if (destination?.id === body.node_id) {
      throw createError({
        statusCode: 400,
        message: "Nie można rozdzielić strony na nią samą.",
      });
    }

    let intoId = destination?.id;
    let createdInto = false;
    if (!intoId) {
      intoId = newDocId();
      createdInto = true;
      if (!body.dry_run) {
        await createRevisionPg(
          tx,
          log,
          user,
          { collection: "nodes", id: intoId },
          { ...body.into_person, type: "person" },
          // Approved because an admin separating two people has reviewed the
          // one they are describing, but not published: the new page starts
          // as a draft for whoever splits to check before anybody reads it.
          { approve: true, published: false },
        );
      }
    }

    // A page that does not exist yet holds nothing, so nothing can collide
    // with it - which is why a split onto a fresh person never reports a
    // duplicate.
    const destinationEdges = createdInto
      ? []
      : await edgesTouchingPg(tx, intoId);
    const edges = planEdgeMoves(
      moving.map(edgeDoc),
      destinationEdges.map(edgeDoc),
      body.node_id,
      intoId,
    );
    const counts = countDispositions(edges);

    if (body.dry_run) {
      return {
        node_id: body.node_id,
        into_id: createdInto ? undefined : intoId,
        created_into: createdInto,
        edges,
        counts,
        marked: false,
        applied: false,
      };
    }

    const moved: string[] = [];
    for (const edge of edges) {
      // Only a move here. A relation the destination already states is left on
      // the page it came from rather than removed: the case for removing it is
      // the merge's case, which nobody has made.
      if (edge.disposition !== "moved" && edge.disposition !== "review")
        continue;
      const stored = byId.get(edge.edge_id)!.data;
      await repointEdgePg(tx, log, edge.edge_id, stored, body.node_id, intoId);
      moved.push(edge.edge_id);
    }

    // The mark is answered by the split that follows it.
    await patchDoc(tx, log, "nodes", body.node_id, {}, ["needs_split"]);
    await recordAuditPg(tx, {
      action: "split",
      collection: "nodes",
      target_id: body.node_id,
      user: user.uid,
      reason: body.reason,
      merge: { into: intoId, moved, collapsed: [] },
    });
    return {
      node_id: body.node_id,
      into_id: intoId,
      created_into: createdInto,
      edges,
      counts,
      marked: false,
      applied: true,
    };
  });
  if (!split.applied || split.marked) return split;

  await useStorage("cache").clear("nitro:handlers");
  return split;
});
