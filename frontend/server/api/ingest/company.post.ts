import { getUser, requireDatascience } from "~~/server/utils/auth";
import { withoutInternalFields } from "~~/server/utils/revisions";
import { editorialTx, type Tx } from "~~/server/db/editorial";
import { newDocId } from "~~/server/db/ids";
import { revisionChangesNothingPg } from "~~/server/db/proposals";
import {
  createRevisionsPg,
  edgeKey,
  edgesOfPairsPg,
  existingNodeIdsPg,
  placesByKrsPg,
  regionsByTerytPg,
  type RevisionWrite,
  type StoredDoc,
} from "~~/server/db/ingestWrites";
import {
  companyRequestSchema,
  type CompanyRequest as Request,
} from "#shared/api";
import { asArray, pageIsPublic, type EdgeType } from "#shared/model";
import { withRegisterFactsFrom } from "#shared/companyCategories";
import { edgeDocumentId, sameEdges } from "~~/server/utils/edges";

/** The site's „Skarb Państwa" node.
 *
 * A Firestore document id in the source, which is not something to do lightly -
 * but it is the only handle this node has. The Treasury is not in KRS, so it
 * has no `krsNumber`; it is not a territory, so it has no `teryt`; and matching
 * on the name would silently stop linking the day somebody renames it, which is
 * exactly the failure this is meant to end. The id cannot change: it is what
 * every `owns` edge already stored against it points at.
 *
 * Hardcoded on this side of the wire rather than sent in the payload, because a
 * document id is the site's business and the pipelines have no way to know it.
 * `entities.company_bodies` and `scrapers.map.jst` name the Treasury with a
 * sentinel instead, and `owner_skarb_panstwa` carries it here.
 */
export const SKARB_PANSTWA_NODE_ID = "qMsAXmM5nDGNdUqmQpWR";

export default defineEventHandler(async (event) => {
  console.info("Handling ingest/company.post");
  const body: Request = await readValidatedBody(event, (body) =>
    companyRequestSchema.parse(body),
  );
  // The same gate as /api/ingest/person. What this writes goes straight onto
  // the node under an automatic revision nobody reviews, so without it any
  // signed-in account could rename or publish a company. The only caller is
  // `data/pipelines/src/uploader.py`, with a datascience token.
  const user = requireDatascience(await getUser(event));
  return editorialTx((tx, log) =>
    ingestCompany(tx, body).then(async ({ writes, answer }) => {
      await createRevisionsPg(tx, log, user, writes);
      return answer;
    }),
  );
});

/** Everything one payload writes, read and planned in the request's
 * transaction: every lookup is one statement for the whole payload. */
async function ingestCompany(tx: Tx, body: Request) {
  const ownerKrss = [...(body.owners ?? []), ...(body.founders ?? [])].filter(
    Boolean,
  );
  const [companies, regions, treasury] = await Promise.all([
    placesByKrsPg(tx, [body.krs, ...ownerKrss]),
    regionsByTerytPg(tx, [
      ...(body.teryt ? [body.teryt] : []),
      ...(body.owner_teryts ?? []),
      ...(body.founder_teryts ?? []),
    ]),
    existingNodeIdsPg(tx, [SKARB_PANSTWA_NODE_ID]),
  ]);
  const company = companies.get(body.krs);
  // An existing company keeps its visibility: a public one stays public, a
  // pending one is not force-published by a re-ingest. A new one is published.
  const nodeId = company?.id ?? newDocId();
  const stored = company?.data;
  const publish = stored ? pageIsPublic(stored) : true;
  // Layered over what is already stored: a payload carries only the fields the
  // scrapers found, and the revision is written to the node wholesale. Taken
  // from the document the KRS lookup has already read, rather than asking for
  // it a second time.
  const revisionData: Record<string, unknown> = {
    ...withoutInternalFields(stored ?? {}),
    name: body.name,
    type: "place",
    krsNumber: body.krs,
  };
  // A name a person gave the company wins, on the terms `isPublic` and
  // `categories` do below. The register spells every name in capitals and the
  // pipelines add the town, so a payload would put "STAWY MILICKIE (Ruda
  // Sułowska)" back over the "Stawy Milickie" somebody typed, and "POLSKIE LNG
  // (Świnoujście)" over the "Polskie LNG (wykreślone)" that says what the
  // register no longer does. `nameSource` is set by `/api/revisions/create`
  // when a proposal changes the name, and on a page a person creates.
  if (revisionData.nameSource === "manual" && stored?.name) {
    revisionData.name = stored.name;
  }
  if (body.activity && body.activity.length > 0) {
    revisionData.activity = body.activity;
  }
  // Worked out by the pipelines rather than here - see
  // `data/pipelines/src/entities/company_categories.py`. An empty array is a
  // real answer ("this company is in no sector we track") and is written; an
  // absent one means the payload did not compute categories at all and leaves
  // whatever is stored alone.
  //
  // A human answer wins permanently, on the same terms as `isPublic` below:
  // the pipelines see PKD codes, and a code is a claim about activity, not
  // about a sector. Only about the sectors, though. „Skarb Państwa” comes from
  // Prokuratoria's list, which is no less right on a page somebody has edited,
  // so the payload's owner replaces the stored one even there - PGE was pinned
  // to „Energetyka” by hand before the category existed, and no upload could
  // have filed it under the Treasury. The same goes for „W likwidacji” and „W
  // upadłości”, which the register's name says.
  if (body.categories !== undefined) {
    revisionData.categories =
      revisionData.categoriesSource === "manual"
        ? withRegisterFactsFrom(
            asArray<string>(revisionData.categories as string[] | undefined),
            body.categories,
          )
        : body.categories;
  }
  // Which organ supervises the company, on the same terms as `categories`: an
  // empty string is a real answer and an absent one leaves the stored value
  // alone. No `...Source: "manual"` escape hatch, unlike `categories` and
  // `isPublic` below - those exist because a person can know something the
  // register cannot show, and here the register *is* the answer. The value
  // follows from `formaPrawna`, so a wrong one is a bug in
  // `entities/company_bodies.py` rather than something to correct per company.
  //
  // Cleared rather than stored as "": absent is what every ordinary company
  // says, so writing an empty marker onto 3,900 nodes would be a field that
  // means nothing on all but 103 of them.
  if (body.supervisory_body !== undefined) {
    if (body.supervisory_body === "") {
      delete revisionData.supervisoryBody;
    } else {
      revisionData.supervisoryBody = body.supervisory_body;
    }
  }
  // `formaPrawna` verbatim, for display beside a hospital's board on
  // /eksploruj/szpitale. Nothing on the site reads it and decides anything -
  // what follows from the form about pay is `supervisoryBody` above, and about
  // sector is `categories`, both worked out by the pipelines.
  if (body.legal_form) revisionData.legalForm = body.legal_form;
  // The organ the register itself names, as opposed to the one the form
  // implies. Reported, never used as a rule: it is "brak" for most SPZOZ,
  // whose rada społeczna is created by statute and never filed, so it can say
  // a board is unpaid but never that one is paid. See `shared/companyOrgans.ts`
  // for why that keeps it separate from `supervisoryBody`.
  //
  // No "a human answer wins" guard, unlike `isPublic` below, and the
  // difference is where the value comes from. Ownership is something the
  // scrapers *infer* and often cannot see at all, so a human's answer has to
  // outrank theirs. The supervisory organ is something KRS publishes outright
  // and the scrapers only transcribe: there is no form on the site that writes
  // one, so there is no human answer to protect, and if the register is wrong
  // the fix belongs in the register.
  //
  // What it does need is the presence check every ingest field needs: the
  // revision is written to the node wholesale, so a payload from a pipeline
  // that predates the field must leave what is stored alone rather than clear
  // it.
  if (body.supervisory_organ)
    revisionData.supervisoryOrgan = body.supervisory_organ;
  // The company's own Wikipedia article, as the pipelines matched it by KRS
  // number - `wiki_article_for` in data/pipelines/src/analysis/interesting.py.
  // On the terms a person's link is (`updatedPerson` in ingest/person.post.ts):
  // written whenever a payload has one, and left alone when it has not, which
  // keeps a link a reader added to a company the pipelines found no article
  // for.
  if (body.wikipedia) revisionData.wikipedia = body.wikipedia;
  // A human answer wins. KRS cannot see who owns a spółka akcyjna, so the
  // scrapers' `false` is "no evidence" rather than "privately owned", and
  // re-running an ingest must not undo somebody who knew better.
  if (
    body.is_public !== undefined &&
    revisionData.isPublicSource !== "manual"
  ) {
    revisionData.isPublic = body.is_public;
  }

  // `CompaniesPayloads` re-submits every company the site already has, and most
  // runs learn nothing about most of them - the register has not moved, and the
  // categories are worked out from codes that have not moved either. Layered
  // over what is stored, such a payload produces a revision word for word the
  // same as the one the node already carries, and writing it cost a revision
  // document and a rewrite of the node per company per run. See
  // `revisionChangesNothing`, which also refuses to skip where the write would
  // repair something.
  const options = {
    automatic: true,
    approve: publish,
    stored,
    published: publish,
  };
  const changed = !revisionChangesNothingPg("nodes", revisionData, options);
  const writes: RevisionWrite[] = [];
  if (changed) {
    writes.push({
      target: { collection: "nodes", id: nodeId },
      data: revisionData,
      options,
    });
  }

  // The edges this payload asks for, in its order; drawn below once the
  // stored ones are read.
  const plan: PlannedEdge[] = [];

  // Who holds shares, per dział 1 of the register. A company owner is looked up
  // by KRS; a gmina, powiat or województwo has no KRS and arrives as the TERYT
  // code its register name was resolved to.
  const unknownOwners = planOwners(
    plan,
    companies,
    treasury,
    regions,
    body.krs,
    nodeId,
    {
      krss: body.owners,
      teryts: body.owner_teryts,
      skarbPanstwa: body.owner_skarb_panstwa,
    },
  );
  // Who set it up, where a public body did: a foundation or an association
  // holds no shares, so its founder is all the register would have to say
  // about who stands behind it, and the register does not say it. The
  // pipelines name it by hand (`PUBLIC_FOUNDERS` in
  // data/pipelines/src/scrapers/krs/researched_owners.py). Drawn as an
  // ownership edge marked `founder`, so everything that reads `owns` as "is
  // behind" (the graph, a region's companies, the public flag) reads it so too,
  // and the page lists it under „Właściciele” labelled as the founder.
  const unknownFounders = planOwners(
    plan,
    companies,
    treasury,
    regions,
    body.krs,
    nodeId,
    {
      krss: body.founders,
      teryts: body.founder_teryts,
      skarbPanstwa: body.founder_skarb_panstwa,
    },
    { founder: true },
  );

  // Where the company is registered. A `seat` edge, not an `owns` one: until
  // the register's shareholder lists were ingested the two were the same type
  // and it did not matter, but a region now points at both the companies seated
  // in it and the ones it holds shares in, and only one of those says where a
  // company is.
  let region: "added" | "existing" | "unknown" | undefined;
  const regionNodeId = body.teryt ? regions.get(body.teryt) : undefined;
  if (body.teryt && !regionNodeId) {
    // A company whose registered seat has no region node is still worth
    // ingesting for its other fields, so this is reported, not fatal.
    console.warn(
      `No region node for TERYT ${body.teryt} (krs=${body.krs}), skipping location`,
    );
    region = "unknown";
  }
  const seat = regionNodeId
    ? { source: regionNodeId, target: nodeId, type: "seat" as const }
    : undefined;

  // Every stored edge the plan could meet, and the company's seats, in one
  // read each.
  const [siblings, seats] = await Promise.all([
    edgesOfPairsPg(tx, [
      ...plan,
      ...(seat ? [seat, { ...seat, type: "owns" as const }] : []),
    ]),
    tx<StoredDoc[]>`
      SELECT id, data FROM edges WHERE target = ${nodeId} AND type = 'seat'
      ORDER BY id`,
  ]);
  const added = new Set<string>();
  const draw = (edge: PlannedEdge): boolean => {
    const edgeData = {
      source: edge.source,
      target: edge.target,
      type: edge.type,
      ...edge.extra,
    };
    const edgeId = edgeDocumentId(edgeData);
    if (added.has(edgeId)) return false;
    if (sameEdges(edgeData, siblings.get(edgeKey(edgeData)) ?? []).length) {
      return false;
    }
    // A seat that predates the `owns`/`seat` split is stored as `owns`, and
    // `scripts/migrate/split-seat-edges.ts` will retype it. Until that has run
    // the pair already carries the fact, so writing a `seat` edge beside it
    // would give the company two seats. Left alone rather than retyped here:
    // retyping is the migration's job, and it has the revisions to move too.
    if (edge.type === "seat") {
      const owns = { ...edgeData, type: "owns" as const };
      if (sameEdges(owns, siblings.get(edgeKey(owns)) ?? []).length) {
        return false;
      }
    }
    added.add(edgeId);
    // Only reached when no such edge exists, so there is nothing stored to
    // carry.
    writes.push({
      target: { collection: "edges", id: edgeId },
      data: edgeData,
      options: { automatic: true, approve: publish, published: publish },
    });
    return true;
  };
  for (const edge of plan) draw(edge);

  if (seat) {
    // A company has one registered seat, so a second one from a different
    // region is not a second fact - it is a disagreement: a stored seat that
    // predates the current register. The correct one is reported and NOT
    // written, rather than the stale one deleted: deleting takes an edge's
    // revisions with it. A seat an admin removed is not a competing claim.
    const conflicting = seats.find(
      ({ data }) =>
        data.deleted !== true && data.source && data.source !== seat.source,
    )?.data.source as string | undefined;
    if (conflicting) {
      console.warn(
        `Company krs=${body.krs} is already seated in ${conflicting}; the register says ${seat.source}. Leaving the stored seat alone.`,
      );
      region = "existing";
    } else {
      region = draw(seat) ? "added" : "existing";
    }
  }

  // What the request did to the company itself, so a caller submitting a few
  // thousand of them can tell a run that changed nothing from one that did -
  // the edges are reported separately, and a company can be left alone while a
  // location edge is added beside it.
  const outcome = !stored ? "created" : changed ? "updated" : "unchanged";

  // `unknownOwners` is reported rather than merely counted: a run in which it
  // jumps is a run where the register started naming shareholders the site does
  // not track, and the per-owner warnings above are one line each in a log of
  // 3,928 uploads. Omitted when nought, so the ordinary response is unchanged.
  return {
    writes,
    answer: {
      id: nodeId,
      code: 200,
      region,
      company: outcome,
      ...(unknownOwners > 0 ? { unknownOwners } : {}),
      ...(unknownFounders > 0 ? { unknownFounders } : {}),
    },
  };
}

/** An edge a payload asks for, before the stored ones are read. */
type PlannedEdge = {
  source: string;
  target: string;
  type: EdgeType;
  extra?: EdgeExtra;
};

/** What an edge says beyond its two ends and its type. Only `founder` so far,
 * which marks an ownership edge as the one from whoever set up a foundation or
 * an association. It takes no part in the edge's id: an `owns` edge is one
 * fact per pair (`edgeSemantics`), so a pair that already has one keeps it as
 * it is. */
type EdgeExtra = { founder?: true };

/** Plans the edges from a company's owners, or from its founders, to it.
 *
 * Returns how many company owners it named that the site does not hold.
 */
function planOwners(
  plan: PlannedEdge[],
  companies: Map<string, StoredDoc>,
  treasury: Set<string>,
  regions: Map<string, string>,
  krs: string,
  target: string,
  owners: { krss?: string[]; teryts?: string[]; skarbPanstwa?: boolean },
  extra: EdgeExtra = {},
): number {
  const role = extra.founder ? "Founder" : "Owner";
  const edge = (source: string): PlannedEdge => ({
    source,
    target,
    type: "owns",
    ...(extra.founder ? { extra } : {}),
  });
  let unknown = 0;
  for (const parent of owners.krss ?? []) {
    if (!parent) continue;
    const parentNode = companies.get(parent);
    if (!parentNode) {
      // The register names companies as shareholders that koryta.pl does not
      // track. Skipped rather than created: minting a place node as a side
      // effect of an ownership edge is a decision about what the site covers,
      // not about this request; and the company itself is still written.
      console.warn(
        `${role} KRS ${parent} is not on the site (krs=${krs}), skipping the edge`,
      );
      unknown += 1;
      continue;
    }
    plan.push(edge(parentNode.id));
  }
  // The Treasury: it has no KRS number and no TERYT, so the pipeline sends a
  // flag and the id lives here. Checked rather than assumed - a local stack
  // has no such node, and an edge to a missing document draws as a nameless
  // dot.
  if (owners.skarbPanstwa) {
    if (treasury.has(SKARB_PANSTWA_NODE_ID)) {
      plan.push(edge(SKARB_PANSTWA_NODE_ID));
    } else {
      console.warn(
        `No „Skarb Państwa" node (${SKARB_PANSTWA_NODE_ID}); skipping the Treasury ${role.toLowerCase()} edge for krs=${krs}`,
      );
    }
  }
  for (const owner of owners.teryts ?? []) {
    if (!owner) continue;
    const regionNodeId = regions.get(owner);
    if (!regionNodeId) {
      // A code that resolves to no node is one the region ingest has not
      // reached yet. Reported rather than fatal, as an unknown seat is.
      console.warn(
        `No region node for ${role.toLowerCase()} TERYT ${owner} (krs=${krs})`,
      );
      continue;
    }
    plan.push(edge(regionNodeId));
  }
  return unknown;
}
