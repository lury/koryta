/** What the Cloud Functions triggers did after a write, done in the write's
 * own transaction on Postgres (docs/postgres/README.md, decision 4):
 *
 * - `onRevisionWritten`: a node's `revisions` summary, from its revisions
 *   (`refresh_node_revisions`, 0501_e_batch_fields.sql);
 * - `onEdgeWritten` + the minute sweep: `content_changed_at` on the pages an
 *   edge write changed (`pagesChangedByEdgeWrite`);
 * - `onNodeWritten`: `stats.isApproved` is `node_stats.is_approved`, and
 *   `nameChunksLower` is not stored (the search index is package A's);
 * - the derived statistics of the nodes the write touched
 *   (`refresh_node_stats_for`, 0601_node_stats_tables.sql, with the
 *   hospital boards of 0603 and the sectors of 0604), and their
 *   `nodeGroupSize` and `searchLine` (`refresh_node_derived_for`,
 *   0602_stats_sql.sql), which the nightly recount used to be the only one
 *   to write;
 * - the nightly `queueTier` of the people a write touched
 *   (`refresh_queue_tiers`), so the queue does not wait for the night.
 *
 * `editorialTx` (editorial.ts) runs this before every commit. */
import type postgres from "postgres";
import { textArray } from "./textArray";
import type { Doc } from "./normalize";
import {
  CONTENT_CHANGED_AT,
  pagesChangedByEdgeWrite,
} from "../../shared/lastmod";
import { revisionCollection } from "../../shared/model";

export type WrittenDoc = {
  collection: string;
  id: string;
  before: Doc | undefined;
  after: Doc | undefined;
};

/** `!!value`, as getNodeGroups reads `hide`. */
const truthy = (value: unknown) => !!value;

/** Edge types whose writes move the ownership tree (place_ancestors). */
const TREE_EDGES = new Set(["owns", "seat"]);

/** The ids each refresh is handed: what a write touched, sorted by how far
 * the change reaches. */
export type Touched = {
  /** Nodes whose own stats, queue tier or search line may have moved, and
   * edges whose first revision did. */
  nodes: Set<string>;
  /** Places and regions whose place in the ownership tree (the target of a
   * written `owns` or `seat` edge), type, `isPublic`, `supervisoryBody`,
   * `categories`, `teryt` or `deleted` changed: every company below moves
   * too. */
  wide: Set<string>;
  /** The ends of edges walked from or to differently, deleted or restored
   * ones included (`nodeGroupSize`). */
  ends: Set<string>;
  /** Nodes whose type or `hide` changed (`nodeGroupSize`). */
  changed: Set<string>;
  /** Nodes whose document a search line reads changed: written nodes, and
   * the target of a written `owns` or `seat` edge, whose people's lines
   * name its seat and owners (`searchLine`). An end of another written edge
   * is not one: its document is as it was. */
  docs: Set<string>;
};

export function touchedBy(changes: WrittenDoc[]): Touched {
  const touched: Touched = {
    nodes: new Set(),
    wide: new Set(),
    ends: new Set(),
    changed: new Set(),
    docs: new Set(),
  };
  for (const { collection, id, before, after } of changes) {
    if (collection === "edges") {
      // A deleted edge leads nowhere (nodeGroupSize, 0921).
      const moved =
        before?.type !== after?.type ||
        before?.source !== after?.source ||
        before?.target !== after?.target ||
        (before?.deleted === true) !== (after?.deleted === true);
      const tree =
        TREE_EDGES.has(String(before?.type)) ||
        TREE_EDGES.has(String(after?.type));
      for (const doc of [before, after]) {
        for (const end of [doc?.source, doc?.target]) {
          if (typeof end !== "string") continue;
          touched.nodes.add(end);
          if (moved) touched.ends.add(end);
        }
        // The tree moves below the edge: its target and the places under it
        // get other ancestors. The source keeps its own, and the regions
        // whose ties change are recounted through the target's people.
        if (tree && typeof doc?.target === "string") {
          touched.wide.add(doc.target);
          touched.docs.add(doc.target);
        }
      }
    }
    if (collection === "revisions") {
      for (const doc of [before, after]) {
        if (!doc) continue;
        const docId = (doc.node_id || doc.nodeId) as string | undefined;
        // A node's, or a post's: its first revision says whether the
        // teaser may name it.
        if (docId) touched.nodes.add(docId);
      }
    }
    if (collection === "nodes") {
      touched.nodes.add(id);
      touched.docs.add(id);
      if (
        before?.type !== after?.type ||
        before?.isPublic !== after?.isPublic ||
        before?.supervisoryBody !== after?.supervisoryBody ||
        // node_categories of everybody tied to the place.
        before?.deleted !== after?.deleted ||
        // node_areas of everybody tied to the region.
        before?.teryt !== after?.teryt ||
        JSON.stringify(before?.categories) !== JSON.stringify(after?.categories)
      )
        touched.wide.add(id);
      if (
        before?.type !== after?.type ||
        truthy(before?.hide) !== truthy(after?.hide)
      )
        touched.changed.add(id);
    }
    if (collection === "extractions") {
      for (const doc of [before, after]) {
        if (typeof doc?.personNodeId === "string")
          touched.nodes.add(doc.personNodeId);
      }
    }
    if (collection === "votes" || collection === "notes") {
      for (const doc of [before, after]) {
        if (typeof doc?.nodeId === "string") touched.nodes.add(doc.nodeId);
      }
    }
  }
  return touched;
}

/** node_stats of the nodes a vote or a note is on, in its transaction. */
export async function refreshNodeStats(
  tx: postgres.TransactionSql,
  nodeIds: string[],
): Promise<void> {
  if (nodeIds.length === 0) return;
  await tx`SELECT refresh_node_stats_for(${textArray(nodeIds)}::text[])`;
}

/** The derived statistics of `touched`, in the transaction that wrote them. */
export async function refreshTouched(
  tx: postgres.TransactionSql,
  touched: Touched,
): Promise<void> {
  const ids = textArray([...touched.nodes]);
  if (touched.nodes.size > 0 || touched.wide.size > 0) {
    await tx`SELECT refresh_node_stats_for(${ids}::text[], ${textArray([...touched.wide])}::text[])`;
  }
  if (touched.nodes.size > 0) {
    await tx`SELECT refresh_queue_tiers(now(), ${ids}::text[])`;
  }
  if (touched.nodes.size + touched.ends.size + touched.changed.size > 0) {
    await tx`SELECT refresh_node_derived_for(now(), ${ids}::text[],
      ${textArray([...touched.ends])}::text[], ${textArray([...touched.changed])}::text[],
      ${textArray([...touched.docs])}::text[])`;
  }
}

export async function afterWrites(
  tx: postgres.TransactionSql,
  changes: WrittenDoc[],
  now: string,
): Promise<void> {
  const pages = new Set<string>();
  const revisedNodes = new Set<string>();
  for (const change of changes) {
    if (change.collection === "edges") {
      for (const id of pagesChangedByEdgeWrite(change.before, change.after))
        pages.add(id);
    }
    if (change.collection === "revisions") {
      for (const doc of [change.before, change.after]) {
        if (!doc || revisionCollection(doc) !== "nodes") continue;
        const nodeId = (doc.node_id || doc.nodeId) as string | undefined;
        if (nodeId) revisedNodes.add(nodeId);
      }
    }
  }

  if (pages.size > 0) {
    await tx`
      UPDATE nodes SET data = jsonb_set(data, ${textArray([CONTENT_CHANGED_AT])}::text[], to_jsonb(${now}::text)),
        updated_at = clock_timestamp()
      WHERE id = ANY(${textArray([...pages])}::text[])`;
  }
  if (revisedNodes.size > 0) {
    await tx`SELECT refresh_node_revisions(${textArray([...revisedNodes])}::text[])`;
  }
  await refreshTouched(tx, touchedBy(changes));
}
