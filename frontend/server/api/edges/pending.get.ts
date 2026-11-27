import type { Edge } from "~~/shared/model";
import {
  edgesWithNullRevisionPg,
  nodeNamesPg,
  revisionsForNodesPg,
} from "~~/server/db/edgeQueues";
import { defineEventHandler, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";

/** The relations still waiting for their first review, with their revisions.
 *
 * Drafts by definition, so signed in readers only, and not from a cache:
 * this was a six hour shared entry anybody could fill and anybody could read.
 * Nothing in the app calls it today.
 */
export default defineEventHandler(async (event) => {
  await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const edgesData = (await edgesWithNullRevisionPg()).map(
    ({ id, data }) => ({ id, ...data }) as Edge & { id: string },
  );

  const nodeIds = new Set<string>();
  edgesData.forEach((edge) => {
    if (edge.source && typeof edge.source === "string")
      nodeIds.add(edge.source);
    if (edge.target && typeof edge.target === "string")
      nodeIds.add(edge.target);
  });
  const [nodeNames, revisions] = await Promise.all([
    nodeNamesPg([...nodeIds]),
    revisionsForNodesPg(edgesData.map((e) => e.id)),
  ]);

  const edgesWithDetails = edgesData.map((edge) => ({
    ...edge,
    source_name: nodeNames.get(edge.source) || edge.source,
    target_name: nodeNames.get(edge.target) || edge.target,
    revisions: revisions[edge.id] || [],
  }));

  return Object.fromEntries(edgesWithDetails.map((edge) => [edge.id, edge]));
});
