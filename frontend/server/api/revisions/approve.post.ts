import { requireAdmin } from "~~/server/utils/auth";
import { afterHandPublicationPg } from "~~/server/db/declarationHolds";
import { notifyRevisionReviewed } from "~~/server/utils/revisionNotifications";
import {
  editorialTx,
  readDoc,
  type Data,
  type Tx,
} from "~~/server/db/editorial";
import {
  applyRevisionPg,
  resolveEdgeEndpointsPg,
  revisionTarget,
} from "~~/server/db/revisionWrites";
import type { Edge, Revision } from "~~/shared/model";
import { z } from "zod";

const bodyValidator = z.object({
  revision_id: z.string(),
  /** Publish the target in the same step. Left out, approving changes what the
   * page says without changing who can see it. */
  publish: z.boolean().optional(),
});

/** Refuses to leave an edge published while one of its ends is a draft.
 *
 * Only edges are checked, and only when the write would end with the edge
 * live. A node revision cannot break the rule; an edge revision can, both by
 * being published outright and by moving an end of an already published edge
 * onto a page nobody can open.
 */
async function assertEdgeRevisionPublishable(
  tx: Tx,
  revisionId: string,
  revision: Partial<Revision>,
  publish: boolean | undefined,
): Promise<void> {
  const target = revisionTarget({ ...revision, id: revisionId });
  if (target.collection !== "edges") return;

  const stored: Data = (await readDoc(tx, "edges", target.id, true)) ?? {};
  const willBePublished = publish ?? stored.published === true;
  if (!willBePublished) return;

  const data = (revision.data ?? {}) as Partial<Edge>;
  const source = data.source ?? (stored.source as string | undefined);
  const edgeTarget = data.target ?? (stored.target as string | undefined);
  if (!source || !edgeTarget) return;

  const endpoints = await resolveEdgeEndpointsPg(tx, [
    { id: target.id, source, target: edgeTarget },
  ]);
  const state = endpoints.get(target.id);
  if (state?.publishable) return;

  const names = (state?.blockedBy ?? []).map((node) => node.name ?? node.id);
  throw createError({
    statusCode: 400,
    message: `Nie można opublikować powiązania, którego druga strona nie jest opublikowana: ${names.join(
      ", ",
    )}.`,
  });
}

/** Makes a revision the approved one for its node or edge.
 *
 * Until this existed, `revision_id` was only ever written as a side effect of
 * an ingest writing a revision of its own, so nothing a person suggested could
 * be accepted. Approving is idempotent: re-approving the revision a target
 * already points at rewrites the same snapshot.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );
  const user = await requireAdmin(event);

  const { revision, target, published, before } = await editorialTx(
    async (tx, log) => {
      const revision = (await readDoc(
        tx,
        "revisions",
        body.revision_id,
        true,
      )) as Partial<Revision> | undefined;
      if (!revision) {
        throw createError({
          statusCode: 404,
          message: `Nie ma rewizji o id=${body.revision_id}`,
        });
      }

      // `data` is required by the type but not by anything that wrote these
      // documents, and applying a revision that has none would blank the target.
      if (!revision.data) {
        throw createError({
          statusCode: 422,
          message: `Rewizja ${body.revision_id} nie ma danych do zatwierdzenia.`,
        });
      }

      // Approving an edge revision can leave it published two ways: because the
      // caller asked, or because the edge was already live and the approval
      // carries that across. Either one has to answer to the rule that a
      // relation never outlives its endpoints - and the revision may itself be
      // what moves an end, so the check runs against the snapshot about to be
      // written, not against what is stored now.
      await assertEdgeRevisionPublishable(
        tx,
        body.revision_id,
        revision,
        body.publish,
      );

      const applied = await applyRevisionPg(
        tx,
        log,
        body.revision_id,
        revision as Revision,
        user,
        body.publish,
      );
      return { revision, ...applied };
    },
  );

  // The node and entity endpoints are cached per handler, so a page approved
  // now would otherwise keep serving its previous answer.
  await useStorage("cache").clear("nitro:handlers");

  // A person's page this approval takes from draft to public is a publication
  // by hand, as on /api/nodes/publish: it closes the page's declaration hold.
  if (
    body.publish === true &&
    published &&
    before.type === "person" &&
    before.published !== true &&
    target.collection === "nodes"
  ) {
    await afterHandPublicationPg(target.id, user.uid, true);
  }

  await notifyRevisionReviewed({
    decision: "approved",
    revisionId: body.revision_id,
    revision,
    target,
    published,
    reviewerUid: user.uid,
    siteUrl: useRuntimeConfig(event).public.siteUrl,
  });

  return {
    revision_id: body.revision_id,
    id: target.id,
    collection: target.collection,
    published,
  };
});
