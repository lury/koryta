import { useDb } from "./client";

/** The machine-extracted facts (/api/extractions) on Postgres. */

export type ExtractionFilter = {
  tag?: string;
  articleUrl?: string;
  personNodeId?: string;
  /** `stats.votes.humanVoted` is exactly this. A fact nobody has voted on
   * has no aggregate and matches neither, as Firestore's `==` had it. */
  humanVoted?: boolean;
};

export type ExtractionRow = { id: string; data: Record<string, unknown> };

function where(filter: ExtractionFilter) {
  const sql = useDb();
  return sql`
    WHERE true
    ${filter.tag === undefined ? sql`` : sql`AND jsonb_text(data -> 'tag') = ${filter.tag}`}
    ${filter.articleUrl === undefined ? sql`` : sql`AND jsonb_text(data -> 'articleUrl') = ${filter.articleUrl}`}
    ${filter.personNodeId === undefined ? sql`` : sql`AND person_node_id = ${filter.personNodeId}`}
    ${
      filter.humanVoted === undefined
        ? sql``
        : sql`AND data #> '{stats,votes,humanVoted}' = ${filter.humanVoted ? sql`'true'::jsonb` : sql`'false'::jsonb`}`
    }`;
}

/** How many facts match. Every fact has a `createdAt`
 * (0901_extraction_created_at.sql), so none is left out. */
export async function countExtractionsPg(
  filter: ExtractionFilter,
): Promise<number> {
  const [row] = await useDb()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM extractions ${where(filter)}`;
  return row?.n ?? 0;
}

/** One page of the matching facts, newest first (`extractions_created`). */
export async function listExtractionsPg(
  filter: ExtractionFilter,
  page: { offset: number; limit: number },
): Promise<ExtractionRow[]> {
  return useDb()<ExtractionRow[]>`
    SELECT id, data FROM extractions ${where(filter)}
    ORDER BY created_at DESC, id DESC
    OFFSET ${page.offset} LIMIT ${page.limit}`;
}

export async function readExtractionPg(
  id: string,
): Promise<ExtractionRow | undefined> {
  const [row] = await useDb()<ExtractionRow[]>`
    SELECT id, data FROM extractions WHERE id = ${id}`;
  return row;
}
