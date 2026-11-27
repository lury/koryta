import { wantsLatest } from "~~/server/utils/handlers";
import { pageIsPublic } from "~~/shared/model";
import { readEdgeDoc } from "~~/server/db/edges";
import { readNodeDocs } from "~~/server/db/graph";

/** `references` as stored. The migration turns the numbered-key maps an old
 * write left into lists, but the field is read tolerantly all the same, as
 * `asArray` in `server/utils/nodeFilters` reads it. */
function referenceIds(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

/** One article a relation rests on, as the sources dialog lists it. */
export type EdgeSource = {
  id: string;
  /** Null when the id in `references` resolves to no node at all. Kept rather
   * than dropped: it is a citation to a page that is gone, and the dialog is
   * the only place anybody can see it is there and detach it. */
  name: string | null;
  sourceURL: string | null;
  published: boolean;
};

export type EdgeSources = {
  id: string;
  sources: EdgeSource[];
};

/** The articles one relation cites.
 *
 * The other direction of /api/edges/byReference, and the read half of the POST
 * next to it. `Edge.references` holds ids alone, so every surface that wants to
 * name them - the sources dialog on an entity page above all - would otherwise
 * fetch each node itself.
 *
 * Uncached on purpose. It is read when somebody opens the dialog and again the
 * moment they add a source, and a cached answer would show them their own write
 * missing. It is two primary-key reads, and nothing asks for them until
 * somebody opens the dialog on one relation.
 */
export default defineEventHandler(async (event): Promise<EdgeSources> => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  const includeDrafts = await wantsLatest(event);

  const edge = await readEdgeDoc(id);
  // A draft relation is as absent as a missing one to whoever may not see
  // drafts: it is drawn nowhere for them, so its sources are not theirs either.
  if (!edge || (!includeDrafts && !pageIsPublic(edge))) {
    throw createError({ statusCode: 404, message: "Nie ma takiej relacji." });
  }

  const references = Array.from(new Set(referenceIds(edge.references)));
  const nodes = await readNodeDocs(references);

  const sources = references
    .map((nodeId): EdgeSource => {
      const node = nodes.get(nodeId);
      return {
        id: nodeId,
        name: typeof node?.name === "string" ? node.name : null,
        sourceURL: typeof node?.sourceURL === "string" ? node.sourceURL : null,
        published: !!node && pageIsPublic(node),
      };
    })
    // A draft article, and an id pointing at nothing, are both editors' business
    // rather than a reader's - the same rule the rest of the app applies.
    .filter((source) => (includeDrafts ? true : source.published))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "pl"));

  return { id, sources };
});
