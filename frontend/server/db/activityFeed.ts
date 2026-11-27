import { useDb } from "./client";
import { textArray } from "./textArray";

/** The reads of the activity feed (server/utils/activityFeed.ts and
 * feedTargets.ts) in SQL: one range scan per source on the indexes of
 * 0301_c_user_activity.sql, newest first, and the documents its lines name,
 * read only for the fields the feed looks at. */

export type FeedRow = { id: string; data: Record<string, unknown> };
export type FeedWindow = { sinceIso: string; untilIso: string };

type Sql = ReturnType<typeof useDb>;

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The fields of `paths` (`a` or `a.b`) that `source` holds, as a jsonb
 * object of the same shape: a field the document lacks stays absent and a
 * null stays null, as Firestore's field mask leaves them. */
function projectionText(source: string, paths: readonly string[]): string {
  const top = new Map<string, string[]>();
  for (const path of paths) {
    const [head, ...rest] = path.split(".");
    if (!top.has(head!)) top.set(head!, []);
    if (rest.length > 0) top.get(head!)!.push(rest.join("."));
  }
  const parts = [...top].map(([field, nested]) => {
    const value =
      nested.length === 0
        ? `${source} -> ${quote(field)}`
        : `CASE WHEN jsonb_typeof(${source} -> ${quote(field)}) = 'object' THEN ${projectionText(`(${source} -> ${quote(field)})`, nested)} ELSE ${source} -> ${quote(field)} END`;
    return `CASE WHEN ${source} ? ${quote(field)} THEN jsonb_build_object(${quote(field)}, ${value}) ELSE '{}'::jsonb END`;
  });
  return parts.length === 0 ? `'{}'::jsonb` : parts.join(" || ");
}

function projection(sql: Sql, paths: readonly string[]) {
  return sql.unsafe(projectionText("data", paths));
}

/** Votes whose `updatedAt` falls in the window (`votes_time`). */
export function scanVotesPg(
  window: FeedWindow,
  fields: readonly string[],
  cap: number,
): Promise<FeedRow[]> {
  const sql = useDb();
  return sql<FeedRow[]>`
    SELECT id, ${projection(sql, fields)} AS data FROM votes
    WHERE jsonb_typeof(data -> 'updatedAt') = 'string'
      AND (data ->> 'updatedAt') COLLATE "C" >= ${window.sinceIso}
      AND (data ->> 'updatedAt') COLLATE "C" < ${window.untilIso}
    ORDER BY (data ->> 'updatedAt') COLLATE "C" DESC, id DESC
    LIMIT ${cap}`;
}

/** Notes whose `updatedAt` falls in the window (`notes_time`). */
export function scanNotesPg(
  window: FeedWindow,
  fields: readonly string[],
  cap: number,
): Promise<FeedRow[]> {
  const sql = useDb();
  return sql<FeedRow[]>`
    SELECT id, ${projection(sql, fields)} AS data FROM notes
    WHERE jsonb_typeof(data -> 'updatedAt') = 'string'
      AND (data ->> 'updatedAt') COLLATE "C" >= ${window.sinceIso}
      AND (data ->> 'updatedAt') COLLATE "C" < ${window.untilIso}
    ORDER BY (data ->> 'updatedAt') COLLATE "C" DESC, id DESC
    LIMIT ${cap}`;
}

/** Audit rows whose `at` falls in the window (`audit_at`). */
export function scanAuditPg(
  window: FeedWindow,
  fields: readonly string[],
  cap: number,
): Promise<FeedRow[]> {
  const sql = useDb();
  return sql<FeedRow[]>`
    SELECT id, ${projection(sql, fields)} AS data FROM audit
    WHERE jsonb_typeof(data -> 'at') = 'string'
      AND (data ->> 'at') COLLATE "C" >= ${window.sinceIso}
      AND (data ->> 'at') COLLATE "C" < ${window.untilIso}
    ORDER BY (data ->> 'at') COLLATE "C" DESC, id DESC
    LIMIT ${cap}`;
}

/** Revisions people wrote (`update_automatic` false) in the window
 * (`revisions_human_time`). */
export function scanHumanRevisionsPg(
  window: FeedWindow,
  fields: readonly string[],
  cap: number,
): Promise<FeedRow[]> {
  const sql = useDb();
  return sql<FeedRow[]>`
    SELECT id, ${projection(sql, fields)} AS data FROM revisions
    WHERE data -> 'update_automatic' = 'false'::jsonb
      AND update_time >= ${window.sinceIso} AND update_time < ${window.untilIso}
    ORDER BY update_time DESC, id DESC
    LIMIT ${cap}`;
}

/** Revisions of the given authors in the window, whatever their flag
 * (`revisions_update_user`). */
export function scanAuthorRevisionsPg(
  window: FeedWindow,
  uids: readonly string[],
  fields: readonly string[],
  cap: number,
): Promise<FeedRow[]> {
  if (uids.length === 0) return Promise.resolve([]);
  const sql = useDb();
  return sql<FeedRow[]>`
    SELECT id, ${projection(sql, fields)} AS data FROM revisions
    WHERE (data ->> 'update_user') COLLATE "C" = ANY(${textArray(uids)}::text[])
      AND jsonb_typeof(data -> 'update_user') = 'string'
      AND update_time >= ${window.sinceIso} AND update_time < ${window.untilIso}
    ORDER BY update_time DESC, id DESC
    LIMIT ${cap}`;
}

const TABLES = {
  nodes: "nodes",
  edges: "edges",
  extractions: "extractions",
  revisions: "revisions",
} as const;

/** The documents of `ids` that exist, with only `fields` of each. */
export async function readFieldsPg(
  collection: keyof typeof TABLES,
  ids: readonly string[],
  fields: readonly string[],
): Promise<FeedRow[]> {
  if (ids.length === 0) return [];
  const sql = useDb();
  return sql<FeedRow[]>`
    SELECT id, ${projection(sql, fields)} AS data FROM ${sql(TABLES[collection])}
    WHERE id = ANY(${textArray([...ids])}::text[])`;
}

/** The newest revision filed under each of `nodeIds` (`node_id` exactly, by
 * `update_time`), with only `fields` (`revisions_node_time`). */
export async function newestRevisionsOfPg(
  nodeIds: readonly string[],
  fields: readonly string[],
): Promise<FeedRow[]> {
  if (nodeIds.length === 0) return [];
  const sql = useDb();
  return sql<FeedRow[]>`
    SELECT DISTINCT ON (node_id) node_id AS id, ${projection(sql, fields)} AS data
    FROM revisions
    WHERE node_id = ANY(${textArray([...nodeIds])}::text[])
      AND jsonb_text(data -> 'node_id') = node_id
      AND update_time IS NOT NULL
    ORDER BY node_id, update_time DESC, id DESC`;
}

/** `doc.get(path)` over a row: a dotted path into the document. */
export function getterOf(data: Record<string, unknown>) {
  return (path: string): unknown => {
    let value: unknown = data;
    for (const key of path.split(".")) {
      if (!value || typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  };
}
