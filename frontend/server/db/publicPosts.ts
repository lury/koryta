import { useDb } from "./client";
import { isPublicEmployment } from "../../shared/stats";
import type { Edge } from "../../shared/model";

/**
 * Which of these person pages have a paid public post on them, current or
 * past, in one query over their `employed` edges and the places those lead
 * to. Drafts count; deleted edges do not. The rule itself stays
 * `isPublicEmployment`.
 */
export async function pagesWithAPublicPostPg(
  pageIds: readonly string[],
): Promise<Set<string>> {
  const wanted = [...new Set(pageIds.filter((id) => id))];
  if (wanted.length === 0) return new Set();
  const rows = await useDb()<
    {
      source: string;
      target: string | null;
      name: unknown;
      company: { isPublic?: boolean; supervisoryBody?: string } | null;
    }[]
  >`
    SELECT e.source, e.target, e.data -> 'name' AS name,
      CASE WHEN n.id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
        'isPublic', n.data -> 'isPublic',
        'supervisoryBody', n.data -> 'supervisoryBody')) END AS company
    FROM edges e LEFT JOIN nodes n ON n.id = e.target
    WHERE e.source = ANY(${wanted}::text[]) AND e.type = 'employed'
      AND NOT e.deleted`;
  const found = new Set<string>();
  for (const row of rows) {
    const job = {
      type: "employed",
      target: row.target ?? "",
      name: row.name,
    } as Pick<Edge, "type" | "target" | "name">;
    if (isPublicEmployment(job, row.company)) found.add(row.source);
  }
  return found;
}
