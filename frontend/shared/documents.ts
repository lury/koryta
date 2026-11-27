/** The stored shape of each collection's documents, as zod schemas: what the
 * API validates before it writes, what the migration from Firestore reports
 * against, and what `npm run schemas` turns into JSON Schema and from there
 * into the pipelines' pydantic models, so the site and the pipelines read one
 * definition (decision on 2026-11-26).
 *
 * The shapes are those of shared/model.ts after the migration's
 * normalisation (server/db/normalize.ts): lists are arrays, references are
 * paths and timestamps ISO strings. Objects are loose, so a field this file
 * does not know yet is kept and reported rather than dropped.
 *
 * zod 4's API (`zod/v4`), for its native `toJSONSchema`; the rest of the
 * repository still imports zod 3 from `zod`, and the two do not mix in one
 * schema. */
import { z } from "zod/v4";
import { companyCategoryValues } from "./companyCategories";
import { supervisoryOrgans } from "./companyOrgans";
import { edgeTypes, type nodeTypes } from "./model";
import { auditActions } from "./audit";

/** ISO 8601 as the site writes it: a day, or a moment. */
const isoString = z.string();
/** A date as people type and import it, kept as text: „2025”, „2025-03”,
 * „2025-03-14”. The migration nulls the ones `new Date` cannot read. */
const dateText = z.string().nullable();
const ids = z.array(z.string());

const voteMap = z.record(
  z.string(),
  z.looseObject({ total: z.number() }).catchall(z.number()),
);

const edgeStatsScope = z.looseObject({
  experienceMonths: z.number(),
  latestEmploymentStart: z.string().nullable().optional(),
  targetNodeIds: ids,
  seatNodeIds: ids.optional(),
  currentlyEmployed: z.boolean(),
  currentlyEmployedTargetNodeIds: ids.optional(),
  elections: ids.optional(),
});

/** `SearchLine`: the line the search box draws under a person, as stored
 * (shared/searchLine.ts works it out). */
export const searchLineSchema = z.looseObject({
  /** The town the person is active in („Mielec”), or where no town can be
   * named, the region („powiat sztumski”, „podlaskie”). */
  where: z.string().optional(),
  /** The office won, or the company: „Rada miasta”, „TAURON DYSTRYBUCJA”. */
  what: z.string().optional(),
  /** The year of the election, or when a post ended: „2024”, „do 2025”. */
  when: z.string().optional(),
  /** The far ends of the ties the line names, by id: the tie it is about,
   * and the one its town came from. Not shown; what the search checks the
   * person's current ties against. */
  ties: ids.optional(),
  /** On a line about a run, the election as the edge stats file it:
   * „local-2024:won” for a seat won, „local-2024” for a run. */
  election: z.string().optional(),
});

/** `StoredSearchLines`: one line per kind of reader, over the published
 * ties, over every tie, and over the posts an unpublished person's teaser
 * page may show. A scope with nothing to say is absent. */
export const storedSearchLinesSchema = z.looseObject({
  approved: searchLineSchema.optional(),
  all: searchLineSchema.optional(),
  teaser: searchLineSchema.optional(),
});

/** `NodeRevisions`: computeRevisionsObj's summary (shared/revisions.ts). */
export const nodeRevisionsSchema = z.looseObject({
  latest_id: z.string(),
  latest_time: z.string().nullable(),
  total: z.number(),
  has_unapproved: z.boolean(),
});

/** `NodeStats`. Postgres derives everything but the batch fields
 * (`nodeGroupSize`, `queueTier`, `searchLine`) in 0002_node_stats.sql. */
export const nodeStatsSchema = z.looseObject({
  isApproved: z.boolean(),
  notesCount: z.number(),
  factsCount: z.number().optional(),
  votes: z.looseObject({
    interesting: z.number().optional(),
    quality: z.number().optional(),
    humanVoted: z.boolean().optional(),
    humanCount: z.number().optional(),
    lastVotedAt: isoString.optional(),
    models: z.record(z.string(), z.number()).optional(),
  }),
  edges: z.looseObject({ all: edgeStatsScope, approved: edgeStatsScope }),
  nodeGroupSize: z.number().optional(),
  people: z.number().optional(),
  queueTier: z.number().optional(),
  searchLine: storedSearchLinesSchema.optional(),
});

const pageBase = {
  name: z.string(),
  content: z.string().optional(),
  /** `revisions/<id>` or the bare id; a Firestore reference before. */
  revision_id: z.string().nullable().optional(),
  published: z.boolean().optional(),
  deleted: z.boolean().optional(),
  delete_reason: z.string().optional(),
  merged_into: z.string().optional(),
  needs_split: z
    .looseObject({ reason: z.string(), at: isoString, user: z.string() })
    .optional(),
  votes: voteMap.optional(),
  stats: nodeStatsSchema.optional(),
  revisions: nodeRevisionsSchema.optional(),
  content_changed_at: isoString.optional(),
  hide: z.boolean().optional(),
};

export const personSchema = z
  .looseObject({
    ...pageBase,
    type: z.literal("person"),
    parties: ids.optional(),
    partiesSource: z.literal("manual").optional(),
    birthDate: dateText.optional(),
    education: z.string().optional(),
    wikipedia: z.string().optional(),
    rejestrIo: z.string().optional(),
    ktomaco: z.string().optional(),
    imageUrl: z.string().optional(),
  })
  .meta({ title: "PersonDocument" });

export const placeSchema = z
  .looseObject({
    ...pageBase,
    type: z.literal("place"),
    nameSource: z.literal("manual").optional(),
    krsNumber: z.string().optional(),
    regonNumber: z.string().optional(),
    nipNumber: z.string().optional(),
    wikipedia: z.string().optional(),
    location: z.string().optional(),
    activity: ids.optional(),
    /** Known values in shared/companyCategories.ts; an unknown one is reported
     * by `knownCategories`, not refused, since the pipelines file new ones. */
    categories: ids.optional(),
    categoriesSource: z.literal("manual").optional(),
    legalForm: z.string().optional(),
    supervisoryOrgan: z.enum(supervisoryOrgans).optional(),
    isPublic: z.boolean().optional(),
    isPublicSource: z.literal("manual").optional(),
    supervisoryBody: z.string().optional(),
  })
  .meta({ title: "PlaceDocument" });

export const articleSchema = z
  .looseObject({
    ...pageBase,
    type: z.literal("article"),
    sourceURL: z.string(),
    shortName: z.string().optional(),
    publishedDate: isoString.nullable().optional(),
    meta: z.unknown().optional(),
  })
  .meta({ title: "ArticleDocument" });

export const regionSchema = z
  .looseObject({
    ...pageBase,
    type: z.literal("region"),
    teryt: z.string(),
    color: z.string().optional(),
  })
  .meta({ title: "RegionDocument" });

export const topicSchema = z
  .looseObject({
    ...pageBase,
    type: z.literal("topic"),
    description: z.string().optional(),
  })
  .meta({ title: "TopicDocument" });

export const nodeDocumentSchema = z.discriminatedUnion("type", [
  personSchema,
  placeSchema,
  articleSchema,
  regionSchema,
  topicSchema,
]);

export const edgeDocumentSchema = z.looseObject({
  type: z.enum(edgeTypes),
  source: z.string().min(1),
  target: z.string().min(1),
  name: z.string().optional(),
  label: z.string().optional(),
  content: z.string().optional(),
  start_date: dateText.optional(),
  end_date: dateText.optional(),
  references: ids.optional(),
  published: z.boolean().optional(),
  deleted: z.boolean().optional(),
  revision_id: z.string().nullable().optional(),
  votes: voteMap.optional(),
  traverse: z.unknown().optional(),
  // Candidacies.
  party: z.string().optional(),
  committee: z.string().optional(),
  position: z.string().optional(),
  elected: z.boolean().optional(),
  term: z.string().optional(),
  by_election: z.boolean().optional(),
  party_member: z.string().optional(),
  member_parties: ids.optional(),
  supported_by: z.string().optional(),
  backing_parties: ids.optional(),
  founder: z.boolean().optional(),
});

export const revisionDocumentSchema = z.looseObject({
  node_id: z.string().optional(),
  nodeId: z.string().optional(),
  /** The proposed document, whole; its shape is the target collection's. */
  data: z.record(z.string(), z.unknown()),
  update_time: isoString,
  update_user: z.string(),
  update_automatic: z.boolean().optional(),
  collection: z.enum(["nodes", "edges"]).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  reject_reason: z.string().optional(),
  review_user: z.string().optional(),
  review_time: isoString.optional(),
  revision_id: z.string().nullable().optional(),
});

export const voteDocumentSchema = z
  .looseObject({
    nodeId: z.string().optional(),
    extractionId: z.string().optional(),
    userUid: z.string(),
    /** -5..5 for people (firestore.rules `isSaneVote`); the models' scores. */
    categoryVotes: z.record(z.string(), z.number()),
    comment: z.string().optional(),
    updatedAt: isoString.optional(),
  })
  .refine((vote) => !vote.nodeId !== !vote.extractionId, {
    message: "exactly one of nodeId and extractionId",
  });

export const noteSourceSchema = z.looseObject({
  url: z.string().optional(),
  note: z.string(),
  kind: z.enum(["source", "change_request", "missing"]).optional(),
  articleNodeId: z.string().optional(),
  adminStatus: z.enum(["resolved", "unresolved"]).optional(),
  adminType: z.string().optional(),
  adminTypeDeferred: z.boolean().optional(),
  declarationExtractId: z.string().optional(),
});

export const noteDocumentSchema = z.looseObject({
  userUid: z.string(),
  nodeId: z.string(),
  createdAt: isoString.optional(),
  updatedAt: isoString.optional(),
  sources: z.array(noteSourceSchema).optional(),
});

export const extractionDocumentSchema = z.looseObject({
  url: z.string().optional(),
  justification: z.string().optional(),
  justification_in_text: z.string().nullable().optional(),
  fact_type: z.enum([
    "employment",
    "party_membership",
    "personal_relation",
    "affair_involvement",
  ]),
  person: z.string().optional(),
  organization: z.string().optional(),
  role: z.string().optional(),
  party: z.string().optional(),
  subject: z.string().optional(),
  object: z.string().optional(),
  relation: z.string().optional(),
  affair: z.string().optional(),
  articleUrl: z.string(),
  articleDomain: z.string().optional(),
  articleNodeId: z.string().optional(),
  personNodeId: z.string().optional(),
  personNodeName: z.string().optional(),
  tag: z.string(),
  createdAt: isoString.optional(),
  stats: z.looseObject({}).optional(),
  promotedEdgeIds: ids.optional(),
});

/** `AuditEntry` (shared/audit.ts). */
export const auditDocumentSchema = z.looseObject({
  action: z.enum(auditActions),
  collection: z.enum(["nodes", "edges"]),
  target_id: z.string().min(1),
  revision_id: z.string().optional(),
  user: z.string().min(1),
  at: isoString,
  reason: z.string().optional(),
  merge: z
    .looseObject({
      into: z.string(),
      moved: ids,
      collapsed: ids,
      enriched: ids.optional(),
    })
    .optional(),
  pressed_by: z.string().optional(),
});

/** `ArticleCapture` (shared/capture.ts), as /api/ingest/page writes it. */
export const articlePageDocumentSchema = z.looseObject({
  url: z.string().min(1),
  normalizedUrl: z.string().min(1),
  domain: z.string(),
  title: z.string().nullable(),
  articleNodeId: z.string().optional(),
  storagePath: z.string(),
  htmlSha256: z.string(),
  htmlBytes: z.number(),
  selection: z.string().nullable().optional(),
  source: z.enum(["extension", "paste"]),
  status: z.enum(["stored", "extracting", "done", "error"]),
  capturedBy: z.string(),
  capturedAt: isoString,
  updatedAt: isoString.optional(),
  extraction: z.looseObject({}).optional(),
});

/** `users/{uid}`: what /profil and the newsletter question save, and what
 * the unsubscribe link writes (package C). */
export const userDocumentSchema = z.looseObject({
  displayName: z.string().optional(),
  photoURL: z.string().optional(),
  publicProfile: z.boolean().optional(),
  teamMail: z.boolean().optional(),
  notifications: z.record(z.string(), z.boolean()).optional(),
  newsletter: z.record(z.string(), z.boolean()).optional(),
  newsletterUpdated: z
    .looseObject({
      at: isoString.nullable().optional(),
      via: z.string().optional(),
    })
    .optional(),
});

export const qaCheckDocumentSchema = z.looseObject({
  itemId: z.string(),
  userUid: z.string(),
  status: z.enum(["ok", "issue"]),
  feedback: z.string().optional(),
  createdAt: isoString.optional(),
  updatedAt: isoString.optional(),
});

export const commentDocumentSchema = z.looseObject({
  content: z.string(),
  authorId: z.string(),
  authorName: z.string().optional(),
  createdAt: isoString,
  isLead: z.boolean().optional(),
  nodeId: z.string().nullable().optional(),
  edgeId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
});

export const feedbackDocumentSchema = z.looseObject({
  kind: z.enum(["bug", "idea", "data", "other"]),
  message: z.string(),
  userUid: z.string().optional(),
  contact: z.string().optional(),
  context: z.looseObject({ route: z.string() }),
  createdAt: isoString,
  adminStatus: z.enum(["new", "in_progress", "resolved", "wont_fix"]),
  adminNote: z.string().optional(),
  queueRank: z.number().optional(),
});

export const feedbackLimitDocumentSchema = z.looseObject({
  count: z.number(),
  day: z.string(),
});

export type PersonDocument = z.infer<typeof personSchema>;
export type PlaceDocument = z.infer<typeof placeSchema>;
export type ArticleDocument = z.infer<typeof articleSchema>;
export type RegionDocument = z.infer<typeof regionSchema>;
export type TopicDocument = z.infer<typeof topicSchema>;
export type NodeDocument = z.infer<typeof nodeDocumentSchema>;
export type EdgeDocument = z.infer<typeof edgeDocumentSchema>;
export type RevisionDocument = z.infer<typeof revisionDocumentSchema>;
export type VoteDocumentStored = z.infer<typeof voteDocumentSchema>;
export type NoteDocument = z.infer<typeof noteDocumentSchema>;
export type ExtractionDocument = z.infer<typeof extractionDocumentSchema>;

/** A loose object's fields without the index signature `looseObject` adds,
 * so that the types shared/model.ts takes from here name only what they
 * declare. */
type Declared<T> = { [K in keyof T as string extends K ? never : K]: T[K] };

export type SearchLineFields = Declared<z.infer<typeof searchLineSchema>>;
export type StoredSearchLinesFields = {
  [
    K in keyof Declared<z.infer<typeof storedSearchLinesSchema>>
  ]?: SearchLineFields;
};
export type NodeRevisionsFields = Declared<z.infer<typeof nodeRevisionsSchema>>;
export type VoteDocumentFields = Declared<z.infer<typeof voteDocumentSchema>>;

/** Categories a place carries that shared/companyCategories.ts does not
 * list, for the migration report. */
export function unknownCategories(doc: { categories?: unknown }): string[] {
  const known = new Set<string>(companyCategoryValues);
  return Array.isArray(doc.categories)
    ? doc.categories.filter(
        (c): c is string => typeof c === "string" && !known.has(c),
      )
    : [];
}

/** The Firestore collections with a schema here, by name. The other
 * collections are tables of documents with no schema yet (docs/postgres). */
export const documentSchemas = {
  nodes: nodeDocumentSchema,
  edges: edgeDocumentSchema,
  revisions: revisionDocumentSchema,
  votes: voteDocumentSchema,
  notes: noteDocumentSchema,
  extractions: extractionDocumentSchema,
  audit: auditDocumentSchema,
  articlePages: articlePageDocumentSchema,
  users: userDocumentSchema,
  qaChecks: qaCheckDocumentSchema,
  comments: commentDocumentSchema,
  feedback: feedbackDocumentSchema,
  feedbackLimits: feedbackLimitDocumentSchema,
} as const;

export type SchemaCollection = keyof typeof documentSchemas;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Fails to compile when a node type is added to shared/model.ts without a
 * schema here. */
export const everyNodeTypeHasASchema: Same<
  NodeDocument["type"],
  (typeof nodeTypes)[number]
> = true;
