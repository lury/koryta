import { getUser, requireDatascience } from "~~/server/utils/auth";
import type { ExtractionFact } from "~~/shared/model";
import { normalizePersonName, personNameKeys } from "~~/shared/names";
import { normalizeUrl } from "~~/shared/url";
import { z } from "zod";
import {
  articleUrlsPg,
  insertFactsPg,
  peopleByIdPg,
} from "~~/server/db/extractionIngest";
const factSchema = z.object({
  url: z.string(),
  justification: z.string(),
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
}) satisfies z.ZodType<Omit<ExtractionFact, "articleUrl" | "tag">>;

const articleSchema = z.object({
  url: z.string(),
  domain: z.string(),
  title: z.string().nullable(),
  publication_date: z.string().nullable(),
  extracted_facts: z.array(factSchema),
  tag: z.string(),
  /** Node ids of the people the pipeline confirmed are named in this article.
   *
   * Article-level, because that is what the mention matcher judges: one article
   * usually carries facts about several people, and only some of them are in
   * the graph. Which fact belongs to which of these people is settled here, by
   * name - see `matchPeopleByName`. Optional: the one-shot capture path
   * (`oneshot.py`) analyses a page before any mention matching has run.
   */
  koryta_ids: z.array(z.string()).optional(),
});

const extractionRequestSchema = z.object({
  articles: z.array(articleSchema),
  /** Who these facts should be credited to, when that is not the caller.
   *
   * The capture extractor runs as a service account and submits on behalf of
   * whoever captured the page — without this every fact found that way would be
   * attributed to the service rather than to the person who found the article.
   * Only a datascience caller reaches this endpoint at all, so there is no
   * wider identity to spoof.
   */
  uploaderUid: z.string().min(1).optional(),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    extractionRequestSchema.parse(body),
  );

  const user = requireDatascience(await getUser(event));
  const uploaderUid = body.uploaderUid ?? user.uid;

  // Article nodes by normalized url: the crawler stores
  // `https://www.example.pl/a`, the extraction pipeline sends `example.pl/a`.
  const urlToNodeId = new Map<string, string>();
  for (const { id, sourceURL } of await articleUrlsPg()) {
    urlToNodeId.set(normalizeUrl(sourceURL), id);
  }

  // The people the pipeline confirmed in these articles, read once for the
  // whole batch.
  const peopleById = await peopleByIdPg(
    body.articles.flatMap((article) => article.koryta_ids ?? []),
  );

  const createdAt = new Date().toISOString();
  const allDocs: Record<string, unknown>[] = [];
  for (const article of body.articles) {
    const articleNodeId = urlToNodeId.get(normalizeUrl(article.url));
    const peopleByName = matchPeopleByName(article.koryta_ids, peopleById);
    for (const fact of article.extracted_facts) {
      const doc: Record<string, unknown> = {
        url: fact.url,
        justification: fact.justification,
        justification_in_text: fact.justification_in_text ?? null,
        fact_type: fact.fact_type,
        articleUrl: article.url,
        articleDomain: article.domain,
        tag: article.tag,
        createdAt,
        uploaderUid,
        // The aggregate the votes keep from here on: an unvoted fact is the
        // `humanVoted == false` backlog the review flow reads.
        stats: { votes: { humanVoted: false } },
      };
      if (articleNodeId) {
        doc.articleNodeId = articleNodeId;
      }
      // Which of the article's confirmed people this fact is about: `person`
      // for most types, `subject` for a personal_relation, the pair
      // `factSubject` reads on the card.
      const subject = fact.person || fact.subject;
      const matched = subject
        ? peopleByName.get(normalizePersonName(subject))
        : undefined;
      if (matched) {
        doc.personNodeId = matched.id;
        doc.personNodeName = matched.name;
      }
      if (fact.person !== undefined) doc.person = fact.person;
      if (fact.organization !== undefined) doc.organization = fact.organization;
      if (fact.role !== undefined) doc.role = fact.role;
      if (fact.party !== undefined) doc.party = fact.party;
      if (fact.subject !== undefined) doc.subject = fact.subject;
      if (fact.object !== undefined) doc.object = fact.object;
      if (fact.relation !== undefined) doc.relation = fact.relation;
      if (fact.affair !== undefined) doc.affair = fact.affair;

      allDocs.push(doc);
    }
  }

  // The facts and the recounted `stats.factsCount` of every person they name
  // (recounted, not incremented: the pipeline is re-runnable) in one
  // transaction.
  const peopleUpdated = await insertFactsPg(allDocs);

  return {
    status: "ok",
    count: allDocs.length,
    peopleUpdated,
  };
});

/** One article's confirmed people, keyed by the names a fact may call them.
 *
 * Each under their whole name and the shorter ones an article uses for a name
 * with a middle one in it (`personNameKeys`): a fact about Antoni Ignacy Sikoń
 * says "Antoni Sikoń".
 *
 * A key that two of them share is dropped rather than guessed at: the whole
 * point of the flag on the card is that a namesake is easy to match wrongly, so
 * a case we already know is ambiguous should not be asserted at all. That
 * includes a page named "Jan Kowalski" beside one named "Jan Maria Kowalski".
 */
function matchPeopleByName(
  korytaIds: string[] | undefined,
  peopleById: Map<string, { id: string; name: string }>,
): Map<string, { id: string; name: string }> {
  const byName = new Map<string, { id: string; name: string }>();
  const ambiguous = new Set<string>();
  for (const id of korytaIds ?? []) {
    const person = peopleById.get(id);
    if (!person) continue;
    for (const key of personNameKeys(person.name)) {
      if (byName.has(key) && byName.get(key)!.id !== id) ambiguous.add(key);
      byName.set(key, person);
    }
  }
  for (const key of ambiguous) byName.delete(key);
  return byName;
}
