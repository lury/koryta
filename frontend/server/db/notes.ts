import { createError } from "h3";
import { useDb } from "./client";
import { refreshNodeStats } from "./writeEffects";
import { noteDocumentSchema } from "../../shared/documents";
import { withArticleIds } from "../../app/utils/notePromotion";
import type { Note, NoteRow, NoteSource, NodeType } from "../../shared/model";
import {
  applyTriage,
  mergeNote,
  noteDocId,
  type NoteBody,
  type ServedNote,
  type TriageBody,
} from "../utils/noteRules";

/** Notes on Postgres. `stats.notesCount` is node_stats', refreshed after the
 * write. */

export async function notesOnNodePg(
  nodeId: string,
  signedIn: boolean,
): Promise<ServedNote[]> {
  const sql = useDb();
  if (!signedIn) {
    // The rule's `get()` of the page: a missing page refused the read too.
    const [node] = await sql<{ type: string | null }[]>`
      SELECT type FROM nodes WHERE id = ${nodeId}`;
    if (!node || node.type === "person") return [];
  }
  const rows = await sql<{ id: string; data: Note }[]>`
    SELECT id, data FROM notes WHERE node_id = ${nodeId} ORDER BY id`;
  return rows.map(({ id, data }) => ({ ...data, id }));
}

export async function putOwnNotePg(
  nodeId: string,
  uid: string,
  body: NoteBody,
): Promise<ServedNote> {
  const id = noteDocId(nodeId, uid);
  const note = await useDb().begin(async (tx) => {
    const [row] = await tx<{ data: Note }[]>`
      SELECT data FROM notes WHERE id = ${id} FOR UPDATE`;
    const merged = mergeNote(row?.data ?? null, {
      nodeId,
      uid,
      body,
      now: new Date().toISOString(),
    });
    noteDocumentSchema.parse(merged);
    await tx`
      INSERT INTO notes (id, data) VALUES (${id}, ${tx.json(merged as never)})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    await refreshNodeStats(tx, [nodeId]);
    return merged as Note;
  });
  return { ...note, id };
}

export async function deleteOwnNotePg(
  nodeId: string,
  uid: string,
): Promise<"deleted" | "missing" | "forbidden"> {
  const id = noteDocId(nodeId, uid);
  const outcome = await useDb().begin(async (tx) => {
    const [row] = await tx<{ data: Note }[]>`
      SELECT data FROM notes WHERE id = ${id} FOR UPDATE`;
    if (!row) return "missing" as const;
    if (row.data.userUid !== uid) return "forbidden" as const;
    await tx`DELETE FROM notes WHERE id = ${id}`;
    await refreshNodeStats(tx, [nodeId]);
    return "deleted" as const;
  });
  return outcome;
}

/** Points the author's entries at the article nodes their urls became,
 * re-reading `sources` under the row lock so an entry added meanwhile stays. */
export async function attachArticleIdsPg(
  nodeId: string,
  uid: string,
  articleIds: Map<string, string>,
): Promise<boolean> {
  const id = noteDocId(nodeId, uid);
  return useDb().begin(async (tx) => {
    const [row] = await tx<{ data: Note }[]>`
      SELECT data FROM notes WHERE id = ${id} FOR UPDATE`;
    if (!row || row.data.userUid !== uid) return false;
    const updated = withArticleIds(row.data.sources ?? [], articleIds);
    if (!updated) return false;
    await tx`
      UPDATE notes SET data = jsonb_set(data, '{sources}', ${tx.json(updated as never)}::jsonb),
        updated_at = now()
      WHERE id = ${id}`;
    return true;
  });
}

export async function triageNotePg(body: TriageBody): Promise<void> {
  await useDb().begin(async (tx) => {
    const [row] = await tx<{ data: Note }[]>`
      SELECT data FROM notes WHERE id = ${body.noteId} FOR UPDATE`;
    if (!row) {
      throw createError({ statusCode: 404, message: "Notatka nie istnieje." });
    }
    const sources = applyTriage(row.data, body);
    await tx`
      UPDATE notes SET data = jsonb_set(data, '{sources}', ${tx.json(sources as never)}::jsonb),
        updated_at = now()
      WHERE id = ${body.noteId}`;
  });
}

/** Every note entry, newest first, named after its page or, for a page
 * only proposed, after the newest revision of it. The collection is small
 * and `sources` is an array, so it is read whole and the callers filter,
 * sort and page in memory. */
export async function getNoteRowsPg(): Promise<NoteRow[]> {
  const rows = await useDb()<
    {
      id: string;
      data: Note;
      name: string | null;
      type: NodeType | null;
    }[]
  >`
    SELECT n.id, n.data,
      coalesce(nullif(node.data ->> 'name', ''), rev.name) AS name,
      CASE WHEN nullif(node.data ->> 'name', '') IS NOT NULL THEN node.type
           ELSE rev.type END AS type
    FROM notes n
    LEFT JOIN nodes node ON node.id = n.node_id
    LEFT JOIN LATERAL (
      SELECT nullif(r.data -> 'data' ->> 'name', '') AS name,
             r.data -> 'data' ->> 'type' AS type
      FROM revisions r WHERE r.node_id = n.node_id
      ORDER BY r.update_time DESC NULLS LAST LIMIT 1
    ) rev ON nullif(node.data ->> 'name', '') IS NULL
    ORDER BY n.id`;

  const out: NoteRow[] = [];
  for (const { id, data, name, type } of rows) {
    const named = name ? { nodeName: name, nodeType: type } : null;
    const sources: Partial<NoteSource>[] = data.sources ?? [];
    sources.forEach((source, sourceIndex) => {
      out.push({
        key: `${id}:${sourceIndex}`,
        noteId: id,
        sourceIndex,
        nodeId: data.nodeId,
        nodeName: named?.nodeName ?? null,
        nodeType: named?.nodeType ?? null,
        userUid: data.userUid,
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
        note: source.note ?? "",
        url: source.url || null,
        kind: source.kind ?? "source",
        articleNodeId: source.articleNodeId || null,
        adminStatus: source.adminStatus ?? null,
        adminType: source.adminType || null,
        adminTypeDeferred: source.adminTypeDeferred === true,
      });
    });
  }
  // Newest first by when the note was written, undated at the end.
  out.sort((a, b) => {
    if (a.createdAt === b.createdAt) return 0;
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  return out;
}
