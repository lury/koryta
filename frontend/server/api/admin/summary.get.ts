import { defineEventHandler } from "h3";
import { getUser } from "~~/server/utils/auth";
import { compareNewest, isQueued, OPEN_CAP } from "~~/shared/feedbackQueue";
import type { FeedbackKind, NoteEntryKind } from "~~/shared/model";
import {
  newFeedbackPg,
  nodeNamesPg,
  noteCountsPg,
  pendingEdgeRevisionsPg,
  unapprovedNodesPg,
} from "~~/server/db/adminSummary";

/** Cap on how many unapproved nodes we inspect to split manual vs automatic.
 * Aggregation gives the exact total cheaply, but deciding "automatic" needs a
 * read of each node's latest revision, so we bound that work. */
const MANUAL_INSPECT_CAP = 300;
const SAMPLE_SIZE = 8;

export type AdminSummary = {
  feedback: {
    // Reports nobody has triaged yet: still "nowe", and not given a place in
    // the work queue on /admin/opinie either.
    needsAction: number;
    sample: {
      id: string;
      kind: FeedbackKind;
      message: string;
      route: string;
      pageTitle: string | null;
      createdAt: string;
    }[];
  };
  notes: {
    // Entries waiting on an admin: the ones flagged unresolved by hand, plus
    // every correction nobody has settled yet. See `noteNeedsAction`.
    needsAction: number;
    // Sources nobody has given a type yet, minus the ones a reviewer handed
    // back to the table view - i.e. the length of the phone queue at
    // /admin/notatki/kategoryzacja.
    uncategorized: number;
    sample: {
      noteId: string;
      nodeId: string;
      name: string | null;
      url: string | null;
      note: string;
      kind: NoteEntryKind;
      adminType: string | null;
    }[];
  };
  revisions: {
    // Nodes whose latest revision is not the approved one, plus edge revisions
    // nobody has settled. Counted per node but per *revision* for edges: an
    // edge carries no `has_unapproved` flag, and /admin/rewizje#powiazania -
    // where this number sends a reviewer - lists one row per revision too.
    unapproved: number;
    // Of those, the ones a human filed rather than an automatic import, and
    // which therefore need review. For edges that is a reader proposing a
    // relation; the ingest's own proposals are automatic and live at
    // /admin/rewizje#powiazania rather than being counted here.
    unapprovedManual: number;
    inspected: number;
    // True when there was more of either kind than we inspected, so
    // `unapprovedManual` is a lower bound.
    truncated: boolean;
    sample: {
      // Which queue the entry belongs to, so the dashboard can link to the
      // screen that can act on it.
      kind: "node" | "edge";
      id: string;
      name: string | null;
      type: string;
    }[];
  };
};

/** Dashboard summary for the admin panel. Admin-only, checked on the
 * caller's token before anything is read. */
export default defineEventHandler(async (event): Promise<AdminSummary> => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const [notes, feedback, nodes, edges] = await Promise.all([
    noteCountsPg(SAMPLE_SIZE),
    // Putting a report in the queue is triage too, and that is a field no
    // index answers - so the newest new reports are read and the queued ones
    // taken off the count. Capped: anybody can write a report, and past the
    // cap the count is an upper bound.
    newFeedbackPg(OPEN_CAP),
    unapprovedNodesPg(MANUAL_INSPECT_CAP),
    summariseEdgeRevisions(),
  ]);

  // --- Untriaged feedback ---------------------------------------------------
  const untriagedFeedback = feedback.newest
    .filter((report) => !isQueued(report))
    .sort(compareNewest);
  const queuedNewFeedback = feedback.newest.length - untriagedFeedback.length;
  const feedbackSample = untriagedFeedback
    .slice(0, SAMPLE_SIZE)
    .map((data) => ({
      id: data.id,
      kind: data.kind,
      message: data.message.slice(0, 200),
      route: data.context.route,
      pageTitle: data.context.pageTitle ?? null,
      createdAt: data.createdAt,
    }));

  // --- Unapproved revisions -------------------------------------------------
  // A latest revision that cannot be resolved counts as manual, so that it is
  // not silently dropped from the review queue.
  const manual = nodes.inspected.filter((node) => !node.automatic);
  const nodeSample: AdminSummary["revisions"]["sample"] = manual
    .slice(0, SAMPLE_SIZE)
    .map((node) => ({
      kind: "node",
      id: node.id,
      name: (node.name as string | null | undefined) ?? null,
      type: (node.type as string | null | undefined) ?? "",
    }));

  // --- Node names for the notes sample --------------------------------------
  const names = await nodeNamesPg(notes.sample.map((n) => n.nodeId));

  return {
    feedback: {
      needsAction: feedback.total - queuedNewFeedback,
      sample: feedbackSample,
    },
    notes: {
      needsAction: notes.needsAction,
      uncategorized: notes.uncategorized,
      sample: notes.sample.map((n) => ({
        ...n,
        name: names.get(n.nodeId) ?? null,
      })),
    },
    revisions: {
      unapproved: nodes.total + edges.total,
      unapprovedManual: manual.length + edges.manual,
      inspected: nodes.inspected.length + edges.inspected,
      truncated:
        nodes.total > nodes.inspected.length || edges.total > edges.inspected,
      // Neither kind is squeezed out of the list by the other having more:
      // each is guaranteed half the slots and may spread into what the other
      // leaves unused.
      sample: mergeSamples(nodeSample, edges.sample),
    },
  };
});

/** How many edge proposals are waiting, how many of them a human filed, and a
 * few to show. Mirrors the node half above: an exact total, and a bounded
 * read to split manual from automatic.
 *
 * Counted per revision rather than per edge. An edge can carry more than one
 * proposal - they are addressed by what they assert, so the ingest can file a
 * second about a different field - and the screen this sends a reviewer to
 * lists them one per row, so a per-edge count would not match what they find.
 */
async function summariseEdgeRevisions(): Promise<{
  total: number;
  manual: number;
  inspected: number;
  sample: AdminSummary["revisions"]["sample"];
}> {
  const { total, inspected } = await pendingEdgeRevisionsPg(MANUAL_INSPECT_CAP);
  // A reader adding a relation leaves `update_automatic` unset; the ingest sets
  // it. Same rule as the node half, so one number can cover both.
  const manual = inspected.filter((row) => !row.automatic);
  const sampled = manual.slice(0, SAMPLE_SIZE);

  // Both ends of each sampled edge, so the list reads as "Jan Kowalski ->
  // Powiat kaliski" rather than as a revision id.
  const ends = sampled.flatMap(({ edge }) =>
    [edge?.source, edge?.target].filter(
      (end): end is string => typeof end === "string" && end !== "",
    ),
  );
  const endpointNames = await nodeNamesPg(ends);

  return {
    total,
    manual: manual.length,
    inspected: inspected.length,
    sample: sampled.map(({ id, edge_id, edge }) => {
      // The edge was deleted after the proposal was filed. It still counts as
      // waiting - /admin/rewizje#powiazania is where that gets sorted out - but
      // there is no pair to name it by.
      const pair = edge
        ? [edge.source, edge.target].map((end) =>
            typeof end === "string" ? (endpointNames.get(end) ?? end) : "?",
          )
        : null;
      return {
        kind: "edge" as const,
        id,
        name: pair ? `${pair[0]} → ${pair[1]}` : edge_id || null,
        type: typeof edge?.type === "string" ? edge.type : "",
      };
    }),
  };
}

function mergeSamples(
  nodes: AdminSummary["revisions"]["sample"],
  edges: AdminSummary["revisions"]["sample"],
): AdminSummary["revisions"]["sample"] {
  const half = Math.floor(SAMPLE_SIZE / 2);
  const fromNodes = Math.min(
    nodes.length,
    Math.max(half, SAMPLE_SIZE - edges.length),
  );
  return [
    ...nodes.slice(0, fromNodes),
    ...edges.slice(0, SAMPLE_SIZE - fromNodes),
  ];
}
