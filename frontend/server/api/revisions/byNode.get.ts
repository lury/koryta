import { readDocs } from "~~/server/db/editorial";
import { useDb } from "~~/server/db/client";
import { revisionRowsOfNodePg } from "~~/server/db/revisionQueue";
import { getValidatedQuery, setResponseHeader } from "h3";
import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import { documentId } from "~~/server/utils/requestIds";
import { approvedRevisionId, pageIsPublic } from "~~/shared/model";

const queryValidator = z.object({ nodeId: documentId });

/** Every revision of one page, as raw documents - for a signed in reader only,
 * for the reason `/api/revisions/[id]` gives. */
export default defineEventHandler(async (event) => {
  await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const { nodeId } = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );

  const [rows, nodes] = await Promise.all([
    revisionRowsOfNodePg(nodeId),
    readDocs(useDb(), "nodes", [nodeId]),
  ]);
  const nodeData = nodes.get(nodeId);

  return {
    revisions: rows.map(({ id, data }) => ({ id, ...data })),
    approvedRevisionId: approvedRevisionId(nodeData?.revision_id),
    published: pageIsPublic(nodeData ?? {}),
    /** Whether the node exists at all - a suggestion for a node that was never
     * created has revisions but nothing to approve them onto. */
    exists: nodeData !== undefined,
  };
});
