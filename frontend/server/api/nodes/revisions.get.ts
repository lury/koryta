import { z } from "zod";
import { fetchOptionsValidator, pageOf } from "~~/server/utils/fetch";
import { withDerivedStats } from "~~/server/db/nodes";
import { useDb } from "~~/server/db/client";
import { textArray } from "~~/server/db/textArray";
import { defineEventHandler, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { nodeTypes, pageIsPublic } from "~~/shared/model";
import { normalizeUpdateTime } from "~~/shared/revisions";

const queryValidator = z.object({
  ...fetchOptionsValidator.shape,
  type: z.enum(nodeTypes).optional(),
  status: z.enum(["unapproved", "approved"]).optional(),
  sortBy: z.string().optional(),
  sortDesc: z.enum(["true", "false"]).optional(),
});

/** Pages with their revision state, a page of them at a time, for the
 * „Strony” section of /admin/rewizje.
 *
 * Whole node documents, drafts among them, so signed in readers only - the
 * page that reads this is behind the same login, and until 2026-10-14 the
 * route was not, which put every unpublished page a curl away.
 */
export default defineEventHandler(async (event) => {
  await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  const sql = useDb();
  const where = [
    query.type ? sql`type = ${query.type}` : sql`true`,
    // An equality on the field the "Zaakceptowane" column reads. Either value
    // drops the nodes with no `revisions` map at all, which is what the page
    // wants both ways round: a node nobody has ever revised is neither waiting
    // for approval nor approved, and there are far more of those than of either.
    query.status
      ? sql`(data #> '{revisions,has_unapproved}') = ${query.status === "unapproved" ? sql`'true'::jsonb` : sql`'false'::jsonb`}`
      : sql`true`,
  ];
  // Any field, in the order of its values' types (null, boolean, number,
  // string, array, map) and then the values; a node without it is left out,
  // of the count too. Ties by id in the same direction.
  let order = sql`id ASC`;
  if (query.sortBy) {
    const direction = sql.unsafe(query.sortDesc === "true" ? "DESC" : "ASC");
    if (query.sortBy === "type") {
      where.push(sql`type IS NOT NULL`);
      order = sql`type ${direction}, id ${direction}`;
    } else {
      const field = sql`(data #> ${textArray(query.sortBy.split("."))}::text[])`;
      where.push(sql`${field} IS NOT NULL`);
      order = sql`docstore_rank(${field}) ${direction}, docstore_num(${field}) ${direction},
        (CASE WHEN jsonb_typeof(${field}) = 'string' THEN ${field} #>> '{}' END) COLLATE "C" ${direction},
        ${field} ${direction}, id ${direction}`;
    }
  }
  const clause = where.reduce((acc, part) => sql`${acc} AND ${part}`);
  // A page always, never more than REVISIONS_PAGE_LIMIT: without a limit
  // this was every revised page of the base, 10 MB at x1.
  const { offset, limit } = pageOf({
    ...query,
    limit: Math.min(query.limit ?? REVISIONS_PAGE_LIMIT, REVISIONS_PAGE_LIMIT),
  });
  const [rows, [count]] = await Promise.all([
    sql<{ id: string; data: Record<string, unknown> }[]>`
      SELECT id, data FROM nodes WHERE ${clause} ORDER BY ${order}
      ${offset ? sql`OFFSET ${offset}` : sql``} ${limit !== undefined ? sql`LIMIT ${limit}` : sql``}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM nodes WHERE ${clause}`,
  ]);

  const nodesArray = (await withDerivedStats([...rows])).map(({ id, data }) => {
    const revisions = data.revisions as { latest_time?: unknown } | undefined;
    if (revisions?.latest_time) {
      revisions.latest_time = normalizeUpdateTime(revisions.latest_time);
    }
    return { id, ...data, visibility: pageIsPublic(data) };
  });

  const nodesRecord: Record<string, unknown> = {};
  for (const node of nodesArray) {
    nodesRecord[node.id] = node;
  }

  return { nodes: nodesRecord, total: count?.n ?? 0 };
});

/** The most pages one request lists; /admin/rewizje asks for 100 at most. */
export const REVISIONS_PAGE_LIMIT = 100;
