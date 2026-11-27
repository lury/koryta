import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import { editorialTx, readDoc } from "~~/server/db/editorial";
import { createRevisionPg } from "~~/server/db/revisionWrites";
import { addPromotedEdge } from "~~/server/db/edgeWrites";
import { edgeDocumentId } from "~~/server/utils/edges";
import { edgeTypes } from "~~/shared/model";
import type { ElectionPosition, ExtractionFact } from "~~/shared/model";
import { factEdgeRule } from "~~/shared/factPromotion";
import { electionPositions } from "~~/shared/misc";

const bodyValidator = z.object({
  /** Checked against the declared types. It used to be any truthy string, so a
   * typo stored an edge of a type nothing renders, nothing dedupes - it falls
   * to the `authored` default in `EDGE_SEMANTICS` - and no migration knows
   * about. */
  type: z.enum(edgeTypes),
  source: z.string().min(1),
  target: z.string().min(1),
  name: z.string().optional(),
  content: z.string().optional(),
  text: z.string().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  references: z.array(z.string().min(1)).optional(),
  party: z.string().optional(),
  committee: z.string().optional(),
  /** A declared office, or blank. The form sends "" for every box it left
   * empty, so an empty string has to stay acceptable - what is refused is a
   * value that is neither. */
  position: z
    .string()
    .refine(
      (value) =>
        value === "" || electionPositions.includes(value as ElectionPosition),
      "Nieznane stanowisko wyborcze.",
    )
    .optional(),
  elected: z.boolean().optional(),
  term: z.string().optional(),
  by_election: z.boolean().optional(),
  update_automatic: z.boolean().optional(),
  /** The extracted fact this relation is being made from, when it is one.
   *
   * The fact then records which relation it became, so every card that draws
   * it - on the person's page, in the review queue, on the article's page -
   * says so instead of offering the same promotion to the next reader, who
   * would pick the far end afresh and could land a second relation beside the
   * first. */
  extraction: z.string().min(1).optional(),
});

export default defineEventHandler(async (event) => {
  const body = bodyValidator.parse(await readBody(event));

  const user = await getUser(event);

  const revisionData = {
    source: body.source,
    target: body.target,
    type: body.type,
    name: body.name || "",
    content: body.content || body.text || "",
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    references: body.references || [],
    party: body.party || "",
    committee: body.committee || "",
    position: (body.position || "") as ElectionPosition | "",
    // Null rather than false for a box nobody ticked. `false` is the one
    // value here that would read as a claim - "stood and did not take the
    // seat" - about a named person, made by a form the contributor never
    // touched, and 15 stored candidacies say it for that reason alone. And
    // only on a candidacy: the dialog keeps a ticked box across a change of
    // mind, so a win can arrive riding on the employment picked after it.
    elected: body.type === "election" && body.elected === true ? true : null,
    term: body.term || "",
    by_election: !!body.by_election,
    update_automatic: body.update_automatic || undefined,
  };

  // Derived from the relation's identity rather than allocated at random, so
  // that stating the same thing twice lands on one document. The form could
  // always be submitted twice, and promoting the same extracted fact twice is a
  // second button that does it - both used to leave two edges saying one thing,
  // which every count and every graph then drew twice. `edgeDocumentId` is the
  // rule the ingest paths already store by.
  // Spelled out rather than handed `revisionData`, which stores `null` for a
  // blank date where `Edge` declares the field optional. `edgeDocumentId` reads
  // undefined, null and "" alike, so the two agree on the id either way; this
  // just says so in the types. Every discriminator any edge type declares is
  // here - see `EDGE_SEMANTICS`.
  const edgeId = edgeDocumentId({
    source: revisionData.source,
    target: revisionData.target,
    type: revisionData.type,
    name: revisionData.name,
    content: revisionData.content,
    start_date: revisionData.start_date ?? undefined,
    end_date: revisionData.end_date ?? undefined,
    party: revisionData.party,
    committee: revisionData.committee,
    position: revisionData.position || undefined,
    term: revisionData.term,
  });

  // A promotion is checked against the fact before anything is written: the
  // relation has to be the one the fact's kind becomes (`factEdgeRule`, the
  // rule the card offers the button by), from the person the fact was matched
  // to, to a node of the kind that rule asks for that exists. What this stops
  // is a fact marked by a relation it could not have become - a party
  // membership, a relation from somebody else, or one to a made-up id. It does
  // not stop a signed-in caller from tying a fact to another real relation of
  // that person of the same kind, which costs nothing but the fact's button;
  // a relation it creates is a draft an administrator reviews, as ever.
  const factId = body.extraction;
  return editorialTx(async (tx, log) => {
    if (factId) {
      const factData = (await readDoc(tx, "extractions", factId)) as
        ExtractionFact | undefined;
      const rule = factData ? factEdgeRule(factData) : undefined;
      if (
        !factData ||
        !rule ||
        factData.personNodeId !== body.source ||
        rule.edgeType !== body.type
      ) {
        throw createError({
          statusCode: 400,
          message: "Z tego faktu nie powstanie takie powiązanie.",
        });
      }
      const target = await readDoc(tx, "nodes", body.target);
      if (!target || target.type !== rule.targetType) {
        throw createError({
          statusCode: 400,
          message: "Nie ma w bazie takiej drugiej strony powiązania.",
        });
      }
    }
    // An array rather than one id: the reader picks the far end, so two readers
    // can make two different relations of one fact, and each should be findable
    // from it. /api/edges/delete takes an id back out when it removes the edge.

    // Already there: hand back the id rather than writing over it. A revision
    // write would replace the stored document, and with it whether the relation
    // is published and everything counted on it - so re-adding a live relation
    // would quietly take it off the site. The fact still records a live one:
    // the relation it says is in the graph either way. One an administrator
    // removed is not in the graph, so the fact is left as it was and the caller
    // told why nothing happened - recreating it here would undo the removal
    // without anybody reviewing it.
    const existing = await readDoc(tx, "edges", edgeId, true);
    if (existing) {
      if (existing.deleted === true) {
        return { id: edgeId, created: false, deleted: true };
      }
      if (factId) await addPromotedEdge(tx, log, factId, edgeId);
      return { id: edgeId, created: false };
    }

    if (factId) await addPromotedEdge(tx, log, factId, edgeId);
    // `published: false` said out loud rather than left off: the queue in
    // /admin/krawedzie looks for it. Same as /api/revisions/create for a brand
    // new node.
    await createRevisionPg(
      tx,
      log,
      user,
      { collection: "edges", id: edgeId },
      revisionData,
      { published: false },
    );

    return { id: edgeId, created: true };
  });
});
