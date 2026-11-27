import { requireAdmin } from "~~/server/utils/auth";
import { afterHandPublicationPg } from "~~/server/db/declarationHolds";
import {
  editorialTx,
  patchDoc,
  readDoc,
  recordAuditPg,
} from "~~/server/db/editorial";
import {
  applyRevisionPg,
  cascadeUnpublishEdgesPg,
  latestApplicableRevisionPg,
  type StoredRevision,
} from "~~/server/db/revisionWrites";
import { CONTENT_CHANGED_AT } from "~~/shared/lastmod";
import { notifyRevisionReviewed } from "~~/server/utils/revisionNotifications";
import { z } from "zod";

const bodyValidator = z.object({
  node_id: z.string(),
  published: z.boolean(),
});

/** Toggles the public visibility of a node. Publication is independent of
 * revision approval: a node needs an approved revision (`revision_id`) before
 * it can go live - and where it has none, publishing approves its newest
 * revision to get one - but approving a newer revision never publishes a
 * hidden node on its own. */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const user = await requireAdmin(event);

  const { stored, approvedRevision, hiddenEdges } = await editorialTx(
    async (tx, log) => {
      const stored = await readDoc(tx, "nodes", body.node_id, true);
      if (!stored) {
        throw createError({
          statusCode: 404,
          message: `Node not found for id=${body.node_id}`,
        });
      }

      // Approved on the way up, not refused: see `latestApplicableRevision`.
      // In the same transaction as the publication, so a page never ends up
      // published pointing at nothing.
      let approvedRevision: StoredRevision | null = null;
      if (body.published && !stored.revision_id) {
        approvedRevision = await latestApplicableRevisionPg(tx, body.node_id);
        if (!approvedRevision) {
          throw createError({
            statusCode: 400,
            message:
              "Nie można opublikować strony: nie ma żadnej rewizji, którą dałoby się zatwierdzić.",
          });
        }
        await applyRevisionPg(
          tx,
          log,
          approvedRevision.id,
          approvedRevision,
          user,
        );
      }

      // Hiding the page hides the relations that lean on it: no edge may be
      // published unless both its ends are. Nothing a reader sees changes
      // either way - the graph already drops an edge whose node was filtered
      // out - but the flag would otherwise outlive the page, and republishing
      // it later would bring back relations nobody looked at again.
      const hiddenEdges = body.published
        ? []
        : await cascadeUnpublishEdgesPg(tx, log, body.node_id, user);

      await patchDoc(tx, log, "nodes", body.node_id, {
        published: body.published,
        // The change this endpoint exists to make is the largest one a page
        // ever undergoes, and publishing writes no revision, so
        // `revisions.latest_time` does not move. Without this a page that
        // reached the public today would advertise in the sitemap the date of
        // the bulk ingest that created it. See shared/lastmod.ts.
        [CONTENT_CHANGED_AT]: new Date().toISOString(),
      });
      // The node keeps only the answer; the audit row says who gave it.
      await recordAuditPg(tx, {
        action: body.published ? "publish" : "unpublish",
        collection: "nodes",
        target_id: body.node_id,
        user: user.uid,
      });
      return { stored, approvedRevision, hiddenEdges };
    },
  );

  // Every cached page that counts this node - the explore endpoints, the stats
  // ones - answers from before it was visible until its own maxAge runs out.
  // /api/edges/publish and /api/revisions/approve have always done this; this
  // endpoint never did, so publishing a page with no relations ticked left the
  // whole site six hours behind with nothing to nudge it. Only reaches this
  // container's copy: anything Cloud CDN is holding is governed by the
  // `s-maxage` the cached handler sent, which is why the endpoints a reviewer
  // needs fresh are `editorFresh` as well.
  await useStorage("cache").clear("nitro:handlers");

  // A person's page held on /admin/oswiadczenia that went public has nothing
  // left to wait for, and one taken down again after that waits again.
  // Whichever screen it was pressed on, after the commit, like the message
  // below, and only on a change: pressing publish on a page already public
  // closes no hold.
  if (
    stored.type === "person" &&
    (stored.published === true) !== body.published
  ) {
    await afterHandPublicationPg(body.node_id, user.uid, body.published);
  }

  // After the commit, and never allowed to fail it: the same order and the
  // same reasoning as `/api/revisions/approve`, whose notification this is.
  // Somebody whose suggestion went live this way is owed the message as much
  // as one whose was approved from the queue.
  if (approvedRevision) {
    await notifyRevisionReviewed({
      decision: "approved",
      revisionId: approvedRevision.id,
      revision: approvedRevision,
      target: { collection: "nodes", id: body.node_id },
      published: true,
      reviewerUid: user.uid,
      siteUrl: useRuntimeConfig(event).public.siteUrl,
    });
  }

  return {
    id: body.node_id,
    published: body.published,
    /** The relations hidden along with it, so the admin page can say so. */
    hiddenEdges,
    /** The revision approved to make this publication possible, where the page
     * had none - the admin page says which version it just put in front of
     * readers, since nobody chose it. */
    approvedRevisionId: approvedRevision?.id ?? null,
  };
});
