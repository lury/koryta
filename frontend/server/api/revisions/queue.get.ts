import { z } from "zod";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import type { RevisionRow } from "~~/server/utils/revisionQueue";
import {
  authorRevisionsPg,
  describeRevisionsPg,
  queuePagePg,
  revisionRowsPg,
  scanQueuePg,
} from "~~/server/db/revisionQueue";
import {
  matchesPublished,
  matchesStoredStatus,
  type Proposal,
  type ProposalSubject,
} from "~~/shared/proposals";

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page: z.coerce.number().int().min(1).default(1),
  /** The three states a revision is *stored* in. `superseded` is not one of
   * them - it is a refinement of `approved` worked out from the target - so it
   * is shown on the chip but is not something to filter by. */
  status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
  /** Booleans travel as an enum: `z.coerce.boolean()` reads the string
   * `"false"` as true, which would silently invert this filter. */
  automatic: z.enum(["true", "false", "all"]).default("false"),
  /** One person's proposals, whatever they are and whenever they were filed.
   * This is the mode the contributor table on /eksploruj/statystyki links to. */
  author: z.string().min(1).optional(),
  /** Everybody's proposals but this person's - in practice the reviewer's own,
   * so what somebody else filed is not buried under their edits. */
  excludeAuthor: z.string().min(1).optional(),
  /** One proposal by id, answered alongside the page and independent of every
   * filter, so a permalink still resolves after the decision is made. */
  revision: z.string().min(1).optional(),
  /** Whether the entry a proposal is about is live - see `ProposalSubject`. */
  published: z.enum(["true", "false", "all"]).default("all"),
  /** One row per entry instead of one per proposal; the page then counts
   * entries. */
  group: z.enum(["subject"]).optional(),
});

/** How many of one person's revisions are read before the answer is a lower
 * bound. The busiest human contributor in production has 94; a pipeline uid has
 * tens of thousands, and this is what stops one from being paged through. */
export const AUTHOR_SCAN_CAP = 500;

/** How many of one entry's proposals a group carries. In the 2026-10-06 export
 * the most anybody had pending was 73, a draft's, all from the pipeline; on a
 * published page, 21. */
export const GROUP_PROPOSAL_CAP = 50;

/** How many revisions one scan reads before its answer is a lower bound. The
 * pending queue held 20,956 in the 2026-10-06 export, 20,523 of them the
 * pipeline's; the approved history is longer, and says so. */
export const QUEUE_SCAN_CAP = 30_000;

/** One entry and the proposals about it, newest first. */
export type QueueGroup = {
  subject: ProposalSubject;
  /** How many proposals match, of which `proposals` holds at most
   * `GROUP_PROPOSAL_CAP`. */
  count: number;
  proposals: Proposal[];
};

export type RevisionQueue = {
  /** The page's proposals; empty when they come in `groups`. */
  revisions: Proposal[];
  /** The page's entries, when the queue was asked to group. */
  groups?: QueueGroup[];
  /** How many entries a grouped answer pages through. */
  groupTotal?: number;
  /** How many proposals match, grouped or not. */
  total: number;
  /** The scan hit its cap, so `total` is a lower bound and older proposals are
   * not in the answer. The aggregate query never reports this. */
  truncated: boolean;
  /** The proposal named by `?revision=`, when it is not already on this page. */
  pinned: Proposal | null;
  /** True when the answer could only include revisions carrying an explicit
   * `update_automatic` flag, i.e. the ones filed since it started being
   * written. See the note on the two query paths below. */
  flagOnly: boolean;
};

/**
 * The review queue: one row per proposal, newest first, human work by default.
 *
 * ## Why there are two query paths
 *
 * `update_automatic` was written *only when true* until this change, so the
 * collection is in three states rather than two: in the 2026-08-21 export,
 * 42,730 revisions say `true`, 54 say `false`, and 1,760 say nothing at all. A
 * Firestore equality matches none of that third group, and there is no filter
 * for "field is absent".
 *
 * That forces a split:
 *
 * - **Without an author**, the query is `update_automatic == false`. It is
 *   exact and cheap - it reads none of the 42,730 - and it covers every
 *   proposal filed through the propose-a-change dialog since review shipped,
 *   which is the backlog an admin actually works through. It cannot see the
 *   older flagless ones, and the page says so (`flagOnly`) rather than
 *   presenting a partial list as the whole of the history.
 * - **With an author**, the query is `update_user == uid` on the composite
 *   index that already exists, and `update_automatic !== true` is applied in
 *   memory. That sees everything the person ever proposed, flag or no flag -
 *   which is the point of a per-person view, and why the contributor table
 *   links to this mode rather than to the aggregate one.
 *
 * `excludeAuthor` is a clause of the query on the first path, not a filter
 * over its answer: dropping one person's rows from a page already cut would leave short pages and a total that counts them anyway. On the
 * second it is applied in memory with the rest, which it can only empty. On
 * the third, below, it comes off the scan before the scan is paged, which
 * keeps the pages and the count as exact, and needs no index.
 *
 * Backfilling the flag was considered and rejected. The uid that wrote 1,447 of
 * the 1,760 flagless revisions is both the owner's admin account and the
 * account the pipeline runs as, so nothing stored on the document tells an old
 * pipeline write from an old human one. Guessing would fill the queue with
 * thousands of rows nobody proposed, which is the failure this page exists to
 * fix, one level up.
 *
 * ## And a third, for what the target is
 *
 * Whether the entry a proposal is about is live (`published`), and grouping by
 * that entry (`group=subject`), are questions about the target - no clause on
 * `revisions` can ask them, and neither can be answered for one page of 25
 * alone. With either set, the aggregate query is read whole, joined to its
 * targets (`scanQueuePg`), and only the rows of the page are read in full.
 */
export default defineEventHandler(async (event): Promise<RevisionQueue> => {
  const caller = await getUser(event);
  if (!caller.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  // Uids, emails and display names. Never cached, never shared - the same
  // reasoning /api/stats/activity applies to its identified branch.
  setResponseHeader(event, "Cache-Control", "private, no-store");

  const page = query.author
    ? await byAuthor(query)
    : query.published !== "all" || query.group
      ? await byScan(query)
      : await byFilter(query);

  const onPage = [
    ...page.revisions,
    ...(page.groups ?? []).flatMap((group) => group.proposals),
  ];
  return {
    ...page,
    pinned: query.revision ? await onePinned(query.revision, onPage) : null,
  };
});

type QueryOptions = z.infer<typeof queryValidator>;

/** One person's proposals, read whole and filtered in memory.
 *
 * No `status` clause on purpose: the revisions that carry no
 * status are precisely the history a per-person view exists to show, and an
 * equality would match none of them.
 */
async function byAuthor(
  query: QueryOptions,
): Promise<Omit<RevisionQueue, "pinned">> {
  const scanned = await authorRevisionsPg(query.author!, AUTHOR_SCAN_CAP);
  const docs = scanned.filter(
    (doc) =>
      matchesAutomatic(doc, query) &&
      doc.data.update_user !== query.excludeAuthor,
  );

  // Status is resolved against the target, which needs the join, so the whole
  // scanned set is described before it can be filtered on status. The cap is
  // what keeps that bounded: describing 500 rows is two `getAll` calls.
  const described = await describeRevisionsPg(docs, { withAuthors: true });
  const matching = described.filter(
    (row) =>
      matchesStoredStatus(row.status, query.status) &&
      matchesPublished(row.subject.published, query.published),
  );

  const offset = (query.page - 1) * query.limit;
  const truncated = scanned.length >= AUTHOR_SCAN_CAP;
  if (query.group) {
    const groups = groupBy(matching, (row) => row.subject.id);
    return {
      revisions: [],
      groups: groups.slice(offset, offset + query.limit).map((rows) => ({
        subject: rows[0]!.subject,
        count: rows.length,
        proposals: rows.slice(0, GROUP_PROPOSAL_CAP),
      })),
      groupTotal: groups.length,
      total: matching.length,
      truncated,
      flagOnly: false,
    };
  }
  return {
    revisions: matching.slice(offset, offset + query.limit),
    total: matching.length,
    truncated,
    flagOnly: false,
  };
}

/** The aggregate queue: one statement for the page, one for the count.
 *
 * Every revision this path can match carries an explicit `update_automatic`,
 * and every one of those also carries a `status` - the two fields were written
 * by the same code paths - so filtering on the stored status here is exact.
 */
async function byFilter(
  query: QueryOptions,
): Promise<Omit<RevisionQueue, "pinned">> {
  const { rows, total } = await queuePagePg(
    {
      status: query.status,
      automatic: query.automatic,
      excludeAuthor: query.excludeAuthor,
    },
    (query.page - 1) * query.limit,
    query.limit,
  );
  return {
    revisions: await describeRevisionsPg(rows, { withAuthors: true }),
    total,
    truncated: false,
    flagOnly: query.automatic !== "all",
  };
}

/** The aggregate queue, filtered or grouped by what its proposals are about.
 *
 * Paged over the scan, then each row of the page read in full. Read fresh
 * because the scan is kept for a while: a proposal decided since then - by
 * another admin, or on another server instance - is left out rather than shown
 * as still waiting, and so is one whose entry has been published or taken down
 * since. The page can come out a row or two short for it, which is the honest
 * way round.
 */
async function byScan(
  query: QueryOptions,
): Promise<Omit<RevisionQueue, "pinned">> {
  const scan = await scanQueuePg(
    { status: query.status, automatic: query.automatic },
    QUEUE_SCAN_CAP,
  );
  const matching = scan.rows.filter(
    (row) =>
      matchesPublished(row.published, query.published) &&
      leftIn(row.updateUser, query.excludeAuthor),
  );
  const offset = (query.page - 1) * query.limit;
  const answer = {
    total: matching.length,
    truncated: scan.truncated,
    flagOnly: query.automatic !== "all",
  };

  if (!query.group) {
    const slice = matching.slice(offset, offset + query.limit);
    return {
      ...answer,
      revisions: await describeFresh(
        slice.map((row) => row.id),
        query,
      ),
    };
  }

  const groups = groupBy(matching, (row) => row.subjectId);
  const slice = groups
    .slice(offset, offset + query.limit)
    .map((rows) => rows.slice(0, GROUP_PROPOSAL_CAP));
  const described = new Map(
    (
      await describeFresh(
        slice.flatMap((rows) => rows.map((row) => row.id)),
        query,
      )
    ).map((row) => [row.id, row]),
  );
  const pageGroups = slice.flatMap((rows, index): QueueGroup[] => {
    const proposals = rows.flatMap((row) => described.get(row.id) ?? []);
    if (proposals.length === 0) return [];
    const all = groups[offset + index]!.length;
    return [
      {
        subject: proposals[0]!.subject,
        count: all - (rows.length - proposals.length),
        proposals,
      },
    ];
  });
  return {
    ...answer,
    revisions: [],
    groups: pageGroups,
    groupTotal: groups.length,
  };
}

/** The revisions named, read in full and described - those that still match
 * the query, in the order asked. */
async function describeFresh(
  ids: string[],
  query: QueryOptions,
): Promise<Proposal[]> {
  if (ids.length === 0) return [];
  const current = (await revisionRowsPg(ids)).filter(
    (row) => query.status === "all" || row.data.status === query.status,
  );
  const described = await describeRevisionsPg(current, { withAuthors: true });
  return described.filter((row) =>
    matchesPublished(row.subject.published, query.published),
  );
}

/** Whether a revision by `user` stays in a queue that leaves `excluded` out.
 * The same answer Firestore's `!=` gives the first path: a revision naming
 * nobody goes too. */
function leftIn(user: string | null, excluded: string | undefined): boolean {
  return !excluded || (user !== null && user !== excluded);
}

/** `rows` in runs of one key each, in the order each key first appears - so
 * newest-first rows give the entry with the newest proposal first. */
function groupBy<T>(rows: T[], key: (row: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return [...groups.values()];
}

/** The permalinked proposal, when it is not already on the page. */
async function onePinned(
  revisionId: string,
  onPage: Proposal[],
): Promise<Proposal | null> {
  if (onPage.some((row) => row.id === revisionId)) return null;
  const rows = await revisionRowsPg([revisionId]);
  if (rows.length === 0) return null;
  const [described] = await describeRevisionsPg(rows, { withAuthors: true });
  return described ?? null;
}

function matchesAutomatic(doc: RevisionRow, query: QueryOptions): boolean {
  if (query.automatic === "all") return true;
  const automatic = doc.data.update_automatic === true;
  return automatic === (query.automatic === "true");
}
