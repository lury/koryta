/** Firestore collection -> Postgres table (0001_collections.sql), in the
 * order the loaders load them: the articles and their captures before the
 * facts, which take a missing `createdAt` from them (0901). */
export const collectionTables = {
  nodes: "nodes",
  edges: "edges",
  revisions: "revisions",
  votes: "votes",
  notes: "notes",
  articlePages: "article_pages",
  extractions: "extractions",
  feedback: "feedback",
  feedbackLimits: "feedback_limits",
  newsletterLimits: "newsletter_limits",
  comments: "comments",
  audit: "audit",
  users: "users",
  mail: "mail",
  mailCampaigns: "mail_campaigns",
  mailTokens: "mail_tokens",
  newsletterSubscribers: "newsletter_subscribers",
  activityDaily: "activity_daily",
  qaReleases: "qa_releases",
  qaChecks: "qa_checks",
  stats: "stats",
  declarationCandidacies: "declaration_candidacies",
  declarationExtracts: "declaration_extracts",
  declarationExtractImages: "declaration_extract_images",
  declarationAnswers: "declaration_answers",
  declarationReaderLimits: "declaration_reader_limits",
  declarationReaderFinds: "declaration_reader_finds",
  declarationPublications: "declaration_publications",
  declarationPublishLimits: "declaration_publish_limits",
  declarationLinks: "declaration_links",
  declarationPeople: "declaration_people",
} as const;

/** The `agent-tasks` database, in schema `ops`. */
export const opsCollectionTables = {
  tasks: "ops.tasks",
  jobs: "ops.jobs",
  jobRuns: "ops.job_runs",
  searchQueries: "ops.search_queries",
} as const;

/** Collections that have no table: markers for the minute sweep, which the
 * derived views replace. */
export const droppedCollections = ["edgeStatsDirty", "nodeContentDirty"];

export type Collection = keyof typeof collectionTables;
