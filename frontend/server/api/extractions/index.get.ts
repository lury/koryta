import { z } from "zod";
import { readerAwareCachedEventHandler } from "~~/server/utils/handlers";
import { toExtractionFact } from "~~/server/utils/extractions";
import type { ExtractionFact } from "~~/shared/model";
import {
  countExtractionsPg,
  listExtractionsPg,
  type ExtractionFilter,
} from "~~/server/db/extractions";

// The collection grows with every ingest, so a page is always served — no
// caller needs the whole backlog, and `total` tells them how much they missed.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const queryValidator = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT),
  page: z.coerce.number().int().min(0).default(0),
  tag: z.string().optional(),
  /** Everything extracted from one article.
   *
   * Matched against the url exactly as the uploader sent it, which is the same
   * string a capture stores: `/api/ingest/page` derives both from
   * `parseCrawlUrl`, and the extractor echoes back the url it was handed. No
   * normalisation here, so this stays a plain equality the index can serve.
   */
  articleUrl: z.string().optional(),
  /** Everything the pipeline matched to one person, by their node id.
   *
   * The id rather than the name: `personNodeId` is settled once at ingest,
   * against the graph, and two people share a name often enough that matching
   * the string here would hand a reader somebody else's facts - which is the
   * very mistake the card's "To nie ta osoba" flag exists to report.
   */
  personNodeId: z.string().optional(),
  // Mirrors `hideVoted` on /api/nodes: filters on the vote aggregate that a
  // vote's write keeps on the document, so it costs no extra read.
  reviewed: z.enum(["all", "yes", "no"]).default("all"),
  groupBy: z.enum(["article"]).optional(),
  /** How many match, without any of them.
   *
   * For the teaser a person's page shows a logged out reader: it says how much
   * is behind the login and nothing about what. Blurring the cards in CSS would
   * not do - the sentences would still sit in the html for anyone reading the
   * source, and for a crawler indexing unverified machine claims against a
   * named person's canonical url. So the facts must not be sent at all, and
   * this skips the read that would fetch them.
   *
   * The page sets it for a logged out reader, but a query flag is the caller's
   * to leave off - so the handler forces it below when there is no user rather
   * than trusting this. Kept settable so a signed-in caller can ask for the
   * count alone and skip the page read.
   */
  countOnly: z.coerce.boolean().default(false),
});

export default readerAwareCachedEventHandler(
  async (event) => {
    const query = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );

    // What the `countOnly` comment above promises, enforced. These are
    // unreviewed machine claims about named people, so a caller with no user
    // is told how many there are and never what they say - whatever they
    // asked for. `readerAwareCachedEventHandler` resolves the reader before
    // the cache, so the entry this fills can only ever be served to another
    // logged out caller.
    const countOnly = query.countOnly || event.context.hasUser !== true;

    const filter: ExtractionFilter = {
      tag: query.tag,
      articleUrl: query.articleUrl,
      personNodeId: query.personNodeId,
      humanVoted:
        query.reviewed === "all" ? undefined : query.reviewed === "yes",
    };

    // Count and nothing else. Returned before the page read rather than
    // alongside it, so a caller that only says how many there are never causes
    // the documents to be fetched at all.
    if (countOnly) {
      return { facts: [], total: await countExtractionsPg(filter) };
    }

    // The count is of the filtered query, not the page — it is what tells a
    // reviewer how much backlog is left behind the slice they were served.
    // Newest first, so a freshly ingested batch is what reviewers see.
    const [rows, total] = await Promise.all([
      listExtractionsPg(filter, {
        offset: query.page * query.limit,
        limit: query.limit,
      }),
      countExtractionsPg(filter),
    ]);

    const facts: ExtractionFact[] = rows.map((row) =>
      toExtractionFact(row.id, row.data),
    );

    if (query.groupBy === "article") {
      const articles: Record<
        string,
        { domain: string; facts: ExtractionFact[] }
      > = {};
      for (const fact of facts) {
        const url = fact.articleUrl;
        if (!articles[url]) {
          articles[url] = {
            domain: fact.articleDomain || "",
            facts: [],
          };
        }
        articles[url].facts.push(fact);
      }
      return { articles, total };
    }

    return { facts, total };
  },
  { maxAge: 60 },
);
