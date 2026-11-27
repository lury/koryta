/** The golden scenario: what the site answers on the seed at scale 0.1
 * (`SEED_MODE=seed SEED_SCALE=0.1`, compose.coolify.yaml), read through every
 * GET endpoint of server/api as a visitor, as user@koryta.pl and as
 * admin@koryta.pl, then a scripted sequence of writes and the reads that see
 * them. First recorded on postgres-full, with every read and write on
 * Postgres, as the reference for the native Postgres rewrite (decision on
 * 2026-11-26).
 *
 * Steps run in order against one freshly seeded server; later steps take ids
 * from earlier answers through `ctx`. Runner and setup: scripts/golden/run.ts. */

export type As = "anon" | "user" | "admin";

export type Ctx = Record<string, string | undefined>;

export type Step = {
  name: string;
  as?: As;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string | ((ctx: Ctx) => string);
  query?:
    | Record<string, string | string[]>
    | ((ctx: Ctx) => Record<string, string | string[]>);
  body?: unknown | ((ctx: Ctx) => unknown);
  /** A browser without an account (`x-reader-id`). */
  reader?: string;
  /** Takes what later steps need from the raw answer. */
  save?: (body: unknown, ctx: Ctx) => void;
  /** Waits this long first, for the debounced stats refresh. */
  waitMs?: number;
  /** "status": compare only the status. For answers built on when the seed
   * ran (the feed batches seeded votes by their wall-clock gaps). */
  compare?: "status";
};

/** Every object with an `id` in `value`, depth first. */
export function withIds(value: unknown, out: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) value.forEach((v) => withIds(v, out));
  else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.id === "string") out.push(obj);
    Object.values(obj).forEach((v) => withIds(v, out));
  }
  return out;
}

const firstId =
  (
    keys: string[],
    pick: (o: Record<string, unknown>) => boolean = () => true,
  ) =>
  (body: unknown, ctx: Ctx) => {
    const found = withIds(body).filter(pick);
    keys.forEach((key, i) => {
      ctx[key] ??= found[i]?.id as string | undefined;
    });
  };

const READER = "3f2b7c1e-8d4a-4b6f-9c2e-1a5d7e9f0b3c";
const BORN = "1979-07-15";
const all = "10000";

const reads = (as: As): Step[] => [
  { name: "home timeline", as, path: "/api/stats/homeTimeline" },
  { name: "stats database", as, path: "/api/stats/database" },
  { name: "stats regions", as, path: "/api/stats/regions" },
  { name: "stats queueTiers", as, path: "/api/stats/queueTiers" },
  { name: "stats hospitals", as, path: "/api/stats/hospitals" },
  {
    name: "stats activity 7",
    as,
    path: "/api/stats/activity",
    query: { days: "7" },
  },
  {
    name: "stats activity 30",
    as,
    path: "/api/stats/activity",
    query: { days: "30" },
  },
  {
    name: "progress województwo",
    as,
    path: "/api/stats/progress",
    query: { teryt: "14" },
  },
  {
    name: "progress sektor",
    as,
    path: "/api/stats/progress",
    query: { category: "szpitale" },
  },
  {
    name: "progress partia",
    as,
    path: "/api/stats/progress",
    query: { party: "PO" },
  },
  { name: "declarations people", as, path: "/api/declarations/people" },
  {
    name: "declarations progress",
    as,
    path: "/api/declarations/progress",
    reader: as === "anon" ? READER : undefined,
  },
  {
    name: "nodes person page 1",
    as,
    path: "/api/nodes",
    query: { type: "person", limit: "50", page: "1" },
  },
  {
    name: "nodes person page 3",
    as,
    path: "/api/nodes",
    query: { type: "person", limit: "50", page: "3" },
  },
  {
    name: "nodes place all",
    as,
    path: "/api/nodes",
    query: { type: "place", limit: all },
  },
  {
    name: "nodes region",
    as,
    path: "/api/nodes",
    query: { type: "region", limit: all },
  },
  {
    name: "nodes article",
    as,
    path: "/api/nodes",
    query: { type: "article", limit: "50" },
  },
  {
    name: "nodes szpitale",
    as,
    path: "/api/nodes",
    query: { type: "person", category: "szpitale", limit: all },
  },
  {
    name: "nodes szpitale page",
    as,
    path: "/api/nodes",
    query: { type: "person", category: "szpitale", limit: "10", page: "3" },
  },
  {
    name: "nodes szpitale current selected",
    as,
    path: "/api/nodes",
    query: {
      type: "person",
      category: "szpitale",
      currentlyEmployed: "selected",
      limit: "20",
    },
  },
  {
    name: "nodes teryt 14",
    as,
    path: "/api/nodes",
    query: { type: "person", teryt: "14", limit: all },
  },
  {
    name: "nodes teryt 14 szpitale",
    as,
    path: "/api/nodes",
    query: { type: "person", teryt: "14", category: "szpitale", limit: all },
  },
  {
    name: "nodes companyTeryt 14",
    as,
    path: "/api/nodes",
    query: { type: "person", companyTeryt: "14", limit: all },
  },
  {
    name: "nodes party PO",
    as,
    path: "/api/nodes",
    query: { type: "person", party: "PO", limit: all },
  },
  {
    name: "nodes party none",
    as,
    path: "/api/nodes",
    query: { type: "person", party: "__NONE__", limit: "50" },
  },
  {
    name: "nodes election local-2024",
    as,
    path: "/api/nodes",
    query: { type: "person", election: "local-2024", limit: all },
  },
  {
    name: "nodes elections won",
    as,
    path: "/api/nodes",
    query: {
      type: "person",
      election: ["local-2024", "parliament-2023"],
      electionResult: "won",
      limit: all,
    },
  },
  {
    name: "nodes queueTier 1",
    as,
    path: "/api/nodes",
    query: { type: "person", queueTier: "1", limit: all },
  },
  {
    name: "nodes queueTier 2",
    as,
    path: "/api/nodes",
    query: { type: "person", queueTier: "2", limit: all },
  },
  {
    name: "nodes minVotes",
    as,
    path: "/api/nodes",
    query: { type: "person", minVotes: "1", limit: all },
  },
  {
    name: "nodes sort by name desc",
    as,
    path: "/api/nodes",
    query: { type: "person", sortBy: "name", sortDesc: "true", limit: "30" },
  },
  {
    name: "nodes hideVoted queue",
    as,
    path: "/api/nodes",
    query: {
      type: "person",
      category: "szpitale",
      currentlyEmployed: "selected",
      hideVoted: "no_votes",
      visibility: "private",
      limit: "20",
    },
  },
  { name: "search empty", as, path: "/api/search", query: { q: "" } },
  { name: "search ko", as, path: "/api/search", query: { q: "ko" } },
  {
    name: "search kowalski",
    as,
    path: "/api/search",
    query: { q: "kowalski" },
  },
  {
    name: "search szpital",
    as,
    path: "/api/search",
    query: { q: "szpital wojewódzki" },
  },
  {
    name: "search sp z",
    as,
    path: "/api/search",
    query: { q: "sp z", limit: "5" },
  },
  { name: "search krs", as, path: "/api/search", query: { q: "0000" } },
  {
    name: "edges recentEmployments",
    as,
    path: "/api/edges/recentEmployments",
    query: { limit: "20" },
  },
  {
    name: "edges serviceMilestones",
    as,
    path: "/api/edges/serviceMilestones",
    query: { limit: "20" },
  },
  { name: "nodes articles index", as, path: "/api/nodes/articles" },
  {
    name: "nodes articles list",
    as,
    path: "/api/nodes/articles/list",
    query: { limit: "20", page: "1" },
  },
  { name: "articles topics", as, path: "/api/articles/topics" },
  { name: "topics", as, path: "/api/topics" },
  { name: "blog", as, path: "/api/blog" },
  { name: "sitemap person", as, path: "/api/_sitemap-urls/person" },
  { name: "sitemap place", as, path: "/api/_sitemap-urls/place" },
  {
    name: "comments list",
    as,
    path: "/api/comments/list",
    query: (c) => ({ nodeId: c.p0! }),
  },
  { name: "node person", as, path: (c) => `/api/nodes/${c.p0}` },
  { name: "node place", as, path: (c) => `/api/nodes/${c.c0}` },
  { name: "node article", as, path: (c) => `/api/nodes/${c.a0}` },
  { name: "node missing", as, path: "/api/nodes/nie-ma-takiej-strony" },
  { name: "node teaser", as, path: (c) => `/api/nodes/${c.p0}/teaser` },
  { name: "node mentions", as, path: (c) => `/api/nodes/${c.p0}/mentions` },
  { name: "node url", as, path: (c) => `/api/nodes/${c.p0}/url` },
  {
    name: "node declarations",
    as,
    path: (c) => `/api/nodes/${c.p0}/declarations`,
  },
  { name: "graph local person", as, path: (c) => `/api/graph/local/${c.p0}` },
  { name: "graph local place", as, path: (c) => `/api/graph/local/${c.c0}` },
  {
    name: "graph local post",
    as,
    method: "POST",
    path: (c) => `/api/graph/local/${c.p0}`,
    body: (c) => ({ subjects: [c.p0, c.p1, c.p2], distance: 2 }),
  },
  { name: "graph article", as, path: (c) => `/api/graph/article/${c.a0}` },
  {
    name: "edges successions company",
    as,
    path: "/api/edges/successions",
    query: (c) => ({ companyId: c.c0! }),
  },
  {
    name: "edges successions person",
    as,
    path: "/api/edges/successions",
    query: (c) => ({ personId: c.p0! }),
  },
  {
    name: "edges byReference",
    as,
    path: "/api/edges/byReference",
    query: (c) => ({ articleId: c.a0! }),
  },
  {
    name: "edges index",
    as,
    path: "/api/edges",
    query: (c) => ({ nodeId: c.p0! }),
  },
  { name: "edge references", as, path: (c) => `/api/edges/${c.e0}/references` },
  {
    name: "article relations",
    as,
    path: (c) => `/api/articles/${c.a0}/relations`,
  },
  { name: "article notes", as, path: (c) => `/api/articles/${c.a0}/notes` },
  {
    name: "notes of person",
    as,
    path: "/api/notes",
    query: (c) => ({ nodeId: c.p0! }),
  },
  {
    name: "notes of place",
    as,
    path: "/api/notes",
    query: (c) => ({ nodeId: c.c0! }),
  },
  { name: "extractions", as, path: "/api/extractions", query: { limit: "20" } },
  {
    name: "declarations next",
    as,
    path: "/api/declarations/next",
    query: { count: "3" },
    reader: as === "anon" ? READER : undefined,
  },
];

const signedIn = (as: As): Step[] => [
  { name: "me", as, path: "/api/me" },
  { name: "contributions", as, path: "/api/stats/contributions" },
  {
    name: "interactions mine",
    as,
    path: "/api/interactions/mine",
    query: { limit: "20" },
  },
  {
    name: "activity feed",
    as,
    path: "/api/activity/feed",
    query: { days: "7" },
    compare: "status",
  },
  {
    name: "votes mine",
    as,
    path: "/api/votes/mine",
    query: (c) => ({ targets: `${c.p0},${c.c0}` }),
  },
  {
    name: "votes mine extraction",
    as,
    path: "/api/votes/mine",
    query: { kind: "extraction" },
  },
  { name: "qa checks", as, path: "/api/qa/checks" },
  {
    name: "feedback list",
    as,
    path: "/api/feedback/list",
    query: { limit: "20" },
  },
  {
    name: "revisions queue",
    as,
    path: "/api/revisions/queue",
    query: { status: "pending", limit: "50" },
  },
  {
    name: "revisions mine",
    as,
    path: "/api/revisions/mine",
    query: { limit: "20" },
  },
  {
    name: "revisions node",
    as,
    path: "/api/revisions/node",
    query: (c) => ({ nodeId: c.p0! }),
  },
  {
    name: "revisions byNode",
    as,
    path: "/api/revisions/byNode",
    query: (c) => ({ nodeId: c.p0! }),
  },
  { name: "revisions pendingEdges", as, path: "/api/revisions/pendingEdges" },
  { name: "revision one", as, path: (c) => `/api/revisions/${c.r0}` },
  { name: "nodes pending", as, path: "/api/nodes/pending" },
  {
    name: "nodes revisions",
    as,
    path: "/api/nodes/revisions",
    query: { status: "unapproved" },
  },
  { name: "edges pending", as, path: "/api/edges/pending" },
  {
    name: "node declaration crops",
    as,
    path: (c) => `/api/nodes/${c.p0}/declaration-crops`,
  },
  { name: "declarations found", as, path: "/api/declarations/found" },
  {
    name: "users lookup",
    as,
    path: "/api/users/lookup",
    query: { uids: "test-user,test-admin" },
  },
  { name: "admin summary", as, path: "/api/admin/summary" },
  { name: "notes admin", as, path: "/api/notes/admin", query: { limit: "20" } },
];

const adminOnly: Step[] = [
  {
    name: "edges byNode",
    as: "admin",
    path: "/api/edges/byNode",
    query: (c) => ({ nodeId: c.p0! }),
  },
  {
    name: "edges unpublished",
    as: "admin",
    path: "/api/edges/unpublished",
    query: { limit: "20" },
  },
  {
    name: "revisions relations",
    as: "admin",
    path: "/api/revisions/relations",
    query: (c) => ({ nodeId: c.p0! }),
  },
  {
    name: "declarations overview",
    as: "admin",
    path: "/api/declarations/overview",
  },
  {
    name: "admin searches",
    as: "admin",
    path: "/api/admin/searches",
    query: { days: "7" },
  },
  {
    name: "admin mail audience",
    as: "admin",
    path: "/api/admin/mail/audience",
  },
  {
    name: "admin mail campaigns",
    as: "admin",
    path: "/api/admin/mail/campaigns",
  },
  {
    name: "admin mail deliveries",
    as: "admin",
    path: "/api/admin/mail/deliveries",
  },
  { name: "ops tasks", as: "admin", path: "/api/ops/tasks/list" },
  { name: "ops jobs", as: "admin", path: "/api/ops/jobs" },
  {
    name: "ops job requests",
    as: "admin",
    path: "/api/ops/jobs/requests",
    query: { node: "thydra" },
  },
  { name: "pages", as: "admin", path: "/api/pages", query: { limit: "20" } },
  {
    name: "votes pipeline",
    as: "admin",
    path: "/api/votes/pipeline",
    query: { model: "pipeline-pagerank" },
  },
];

/** A person as the pipelines' person ingest sends one. */
const person = (i: number, krs: string) => ({
  name: `Złota Osoba${String.fromCharCode(65 + (i % 26))} Wzorcowa${i}`,
  content: `Osoba z testu wzorcowego nr ${i}.`,
  autoapprove: i % 2 === 0,
  birthDate: `19${60 + (i % 30)}-0${1 + (i % 9)}-1${i % 9}`,
  parties: i % 3 === 0 ? ["PiS"] : [],
  sources: [`https://example.test/wzorzec/${i}`],
  companies: [{ krs, role: "Członek Rady Nadzorczej", start: "2021-03-01" }],
  reportUnplacedEmployments: true,
});

const writes: Step[] = [
  // Revisions: proposed by a reader, approved with publication, rejected.
  {
    name: "revision create",
    as: "user",
    method: "POST",
    path: "/api/revisions/create",
    body: (c) => ({
      node_id: c.p0,
      name: "Zmieniona Osoba Wzorca",
      content: "Nowy opis.",
    }),
    save: (b, c) => {
      c.rev1 = (b as { id?: string }).id;
    },
  },
  {
    name: "revision approve publish",
    as: "admin",
    method: "POST",
    path: "/api/revisions/approve",
    body: (c) => ({ revision_id: c.rev1, publish: true }),
  },
  {
    name: "revision create to reject",
    as: "user",
    method: "POST",
    path: "/api/revisions/create",
    body: (c) => ({ node_id: c.p1, name: "Odrzucona Zmiana", content: "x" }),
    save: (b, c) => {
      c.rev2 = (b as { id?: string }).id;
    },
  },
  {
    name: "revision reject",
    as: "admin",
    method: "POST",
    path: "/api/revisions/reject",
    body: (c) => ({ revision_id: c.rev2, reason: "Brak źródła" }),
  },
  {
    name: "revision create new page",
    as: "user",
    method: "POST",
    path: "/api/revisions/create",
    body: { type: "person", name: "Nowa Osoba Wzorca", content: "Nowa." },
    save: (b, c) => {
      const r = b as { id?: string; node_id?: string };
      c.rev3 = r.id;
      c.newNode = r.node_id;
    },
  },
  {
    name: "revision approve new page",
    as: "admin",
    method: "POST",
    path: "/api/revisions/approve",
    body: (c) => ({ revision_id: c.rev3 }),
  },
  {
    name: "publish new page",
    as: "admin",
    method: "POST",
    path: "/api/nodes/publish",
    body: (c) => ({ node_id: c.newNode, published: true }),
  },
  {
    name: "unpublish a page",
    as: "admin",
    method: "POST",
    path: "/api/nodes/publish",
    body: (c) => ({ node_id: c.p2, published: false }),
  },
  // Relations.
  {
    name: "edge create",
    as: "user",
    method: "POST",
    path: "/api/edges/create",
    body: (c) => ({
      type: "employed",
      source: c.p3,
      target: c.c0,
      name: "Członek Zarządu",
      start_date: "2022-01-01",
    }),
    save: (b, c) => {
      c.edge1 = (b as { id?: string }).id;
    },
  },
  {
    name: "edge update",
    as: "admin",
    method: "POST",
    path: "/api/edges/update",
    body: (c) => ({
      edge_id: c.edge1,
      name: "Prezes Zarządu",
      start_date: "2022-02-01",
    }),
  },
  {
    name: "edge publish",
    as: "admin",
    method: "POST",
    path: "/api/edges/publish",
    body: (c) => ({ edge_ids: [c.edge1], published: true }),
  },
  {
    name: "edge references",
    as: "admin",
    method: "POST",
    path: (c) => `/api/edges/${c.edge1}/references`,
    body: (c) => ({ add: [c.a0] }),
  },
  {
    name: "edge delete",
    as: "admin",
    method: "POST",
    path: "/api/edges/delete",
    body: (c) => ({ edge_id: c.e0, reason: "Duplikat" }),
  },
  // Pages.
  {
    name: "merge",
    as: "admin",
    method: "POST",
    path: "/api/nodes/merge",
    body: (c) => ({
      duplicate_id: c.p4,
      survivor_id: c.p3,
      reason: "Ta sama osoba",
    }),
  },
  {
    name: "split mark",
    as: "admin",
    method: "POST",
    path: "/api/nodes/split",
    body: (c) => ({ node_id: c.p1, reason: "Dwie osoby", mark_only: true }),
  },
  // Client writes.
  {
    name: "vote person",
    as: "user",
    method: "PUT",
    path: (c) => `/api/votes/${c.p5}`,
    body: { categoryVotes: { interesting: 3, quality: -1 } },
  },
  {
    name: "vote place",
    as: "admin",
    method: "PUT",
    path: (c) => `/api/votes/${c.c0}`,
    body: { categoryVotes: { interesting: 5 } },
  },
  {
    name: "vote out of range",
    as: "user",
    method: "PUT",
    path: (c) => `/api/votes/${c.p5}`,
    body: { categoryVotes: { interesting: 6 } },
  },
  {
    name: "vote delete",
    as: "admin",
    method: "DELETE",
    path: (c) => `/api/votes/${c.c0}`,
  },
  {
    name: "note put",
    as: "user",
    method: "PUT",
    path: (c) => `/api/notes/${c.c0}`,
    body: { sources: [{ note: "wzorcowe źródło", kind: "source" }] },
  },
  {
    name: "note put person",
    as: "user",
    method: "PUT",
    path: (c) => `/api/notes/${c.p5}`,
    body: { sources: [{ note: "druga notatka", kind: "source" }] },
  },
  {
    name: "note delete",
    as: "user",
    method: "DELETE",
    path: (c) => `/api/notes/${c.p5}`,
  },
  {
    name: "me patch",
    as: "user",
    method: "PATCH",
    path: "/api/me",
    body: {
      displayName: "Wzorcowy Czytelnik",
      newsletter: { callsToAction: true },
      newsletterVia: "prompt",
    },
  },
  {
    name: "qa check",
    as: "user",
    method: "PUT",
    path: "/api/qa/checks/qa-changelog",
    body: { status: "issue", feedback: "dalej nie" },
  },
  {
    name: "comment create",
    as: "user",
    method: "POST",
    path: "/api/comments/create",
    body: (c) => ({ content: "Wzorcowy komentarz.", nodeId: c.p5 }),
  },
  {
    name: "feedback create",
    as: "user",
    method: "POST",
    path: "/api/feedback/create",
    body: {
      kind: "bug",
      message: "Wzorcowe zgłoszenie.",
      context: { route: "/" },
    },
  },
  {
    name: "feedback anonymous",
    as: "anon",
    method: "POST",
    path: "/api/feedback/create",
    body: {
      kind: "idea",
      message: "Bez konta.",
      contact: "ktos@example.test",
      context: { route: "/eksploruj" },
    },
  },
  // The pipelines' uploads.
  {
    name: "ingest company",
    as: "admin",
    method: "POST",
    path: "/api/ingest/company",
    body: {
      krs: "0000999001",
      name: "WZORCOWA SPÓŁKA Z O.O.",
      teryt: "1465011",
    },
  },
  {
    name: "ingest article",
    as: "admin",
    method: "POST",
    path: "/api/ingest/article",
    body: (c) => ({
      url: "https://example.test/artykul-wzorcowy",
      name: "Artykuł wzorcowy",
      publishedDate: "2025-05-05",
      mentions: [c.p0, c.p3],
    }),
  },
  ...[0, 1, 2, 3, 4].map((i): Step => ({
    name: `ingest person ${i}`,
    as: "admin",
    method: "POST",
    path: "/api/ingest/person",
    body: (c) => person(i, c.krs0 ?? "0000999001"),
  })),
  {
    name: "ingest person again",
    as: "admin",
    method: "POST",
    path: "/api/ingest/person",
    body: (c) => person(0, c.krs0 ?? "0000999001"),
  },
  // Declarations: one crop of a seeded person, answered by two readers.
  {
    name: "ingest declarations",
    as: "admin",
    method: "POST",
    path: "/api/ingest/declarations",
    body: (c) => ({
      tag: "golden-v1",
      runId: "golden-1",
      candidacies: [
        {
          key: "0123456789abcdef",
          kids: [c.p6],
          teryt: "021704",
          unitName: "Strzelin (gmina miejsko-wiejska)",
          level: "gmina",
          office: "Rada gminy",
          year: 2024,
          status: "found",
          reason: "named",
          files: 1,
        },
      ],
      extracts: [
        {
          sha256: "a".repeat(64),
          page: 0,
          url: "https://bip.example.test/download/golden-2023",
          declarationYear: 2023,
          candidacies: ["0123456789abcdef"],
          outcome: "crop",
          images: { date: PNG, name: PNG },
        },
      ],
    }),
  },
  {
    name: "declarations next user",
    as: "user",
    path: "/api/declarations/next",
    query: { count: "5" },
    save: firstId(["crop0"]),
  },
  {
    name: "declarations answer user",
    as: "user",
    method: "POST",
    path: (c) =>
      `/api/declarations/${c.crop0 ?? `${"a".repeat(64)}-p0`}/answer`,
    body: { verdict: "date", value: BORN },
  },
  {
    name: "declarations answer anonymous",
    as: "anon",
    reader: READER,
    method: "POST",
    path: (c) =>
      `/api/declarations/${c.crop0 ?? `${"a".repeat(64)}-p0`}/answer`,
    body: { verdict: "date", value: BORN },
  },
  {
    name: "declarations settle",
    as: "admin",
    method: "POST",
    path: (c) =>
      `/api/declarations/${c.crop0 ?? `${"a".repeat(64)}-p0`}/settle`,
    body: { verdict: "date", value: BORN },
  },
  {
    name: "declarations overview after",
    as: "admin",
    path: "/api/declarations/overview",
  },
  // What the writes changed, once the stats have refreshed.
  {
    name: "after: node person",
    as: "anon",
    path: (c) => `/api/nodes/${c.p0}`,
    waitMs: 8000,
  },
  {
    name: "after: node person latest",
    as: "admin",
    path: (c) => `/api/nodes/${c.p0}`,
  },
  {
    name: "after: new page",
    as: "anon",
    path: (c) => `/api/nodes/${c.newNode}`,
  },
  { name: "after: merged page", as: "anon", path: (c) => `/api/nodes/${c.p4}` },
  {
    name: "after: nodes szpitale",
    as: "admin",
    path: "/api/nodes",
    query: { type: "person", category: "szpitale", limit: all },
  },
  {
    name: "after: nodes minVotes",
    as: "admin",
    path: "/api/nodes",
    query: { type: "person", minVotes: "1", limit: all },
  },
  {
    name: "after: revisions queue",
    as: "admin",
    path: "/api/revisions/queue",
    query: { status: "pending", limit: "50" },
  },
  {
    name: "after: revisions byNode",
    as: "admin",
    path: "/api/revisions/byNode",
    query: (c) => ({ nodeId: c.p0! }),
  },
  {
    name: "after: graph local",
    as: "admin",
    path: (c) => `/api/graph/local/${c.p3}`,
  },
  {
    name: "after: notes of place",
    as: "user",
    path: "/api/notes",
    query: (c) => ({ nodeId: c.c0! }),
  },
  {
    name: "after: comments",
    as: "anon",
    path: "/api/comments/list",
    query: (c) => ({ nodeId: c.p5! }),
  },
  {
    name: "after: feedback list",
    as: "admin",
    path: "/api/feedback/list",
    query: { limit: "20" },
  },
  {
    name: "after: contributions",
    as: "user",
    path: "/api/stats/contributions",
  },
  { name: "after: me", as: "user", path: "/api/me" },
  {
    name: "after: search",
    as: "anon",
    path: "/api/search",
    query: { q: "wzorc" },
  },
  { name: "after: stats database", as: "admin", path: "/api/stats/database" },
];

/** A 1×1 PNG, for the declaration crop images. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export const scenario: Step[] = [
  // Ids the rest of the run uses, from the deterministic seed.
  {
    name: "pick people",
    path: "/api/nodes",
    query: { type: "person", limit: "10", page: "2" },
    save: firstId(
      ["p0", "p1", "p2", "p3", "p4", "p5", "p6"],
      (o) => o.type === "person",
    ),
  },
  {
    name: "pick a company",
    path: "/api/nodes",
    query: { type: "place", category: "szpitale", limit: "5" },
    save: (b, c) => {
      const place = withIds(b).find(
        (o) => o.type === "place" && typeof o.krsNumber === "string",
      );
      c.c0 =
        (place?.id as string | undefined) ??
        (withIds(b)[0]?.id as string | undefined);
      c.krs0 = place?.krsNumber as string | undefined;
    },
  },
  {
    name: "pick an article",
    path: "/api/nodes",
    query: { type: "article", limit: "5" },
    save: firstId(["a0"], (o) => o.type === "article"),
  },
  {
    name: "pick an edge",
    path: (c) => `/api/graph/local/${c.p0}`,
    save: (b, c) => {
      const edge = withIds(b).find(
        (o) => typeof o.source === "string" && typeof o.target === "string",
      );
      c.e0 = edge?.id as string | undefined;
    },
  },
  {
    name: "pick a revision",
    as: "admin",
    path: "/api/revisions/node",
    query: (c) => ({ nodeId: c.p0! }),
    save: firstId(["r0"]),
  },
  ...reads("anon"),
  ...reads("user"),
  ...signedIn("user"),
  ...reads("admin"),
  ...signedIn("admin"),
  ...adminOnly,
  ...writes,
];
