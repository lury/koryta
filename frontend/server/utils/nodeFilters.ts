// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodeDoc = any;

/** The places and regions a node's stored stats tie it to in `edgeScope`:
 * every target, or only the current posts' with `currentlyEmployed=selected`
 * - the arrays the list's company and region filters match on
 * (server/db/nodes.ts, `structuralFilters`). */
function memTargets(
  node: NodeDoc,
  edgeScope: "all" | "approved",
  currentlyEmployed?: string,
): string[] {
  const edges = node.stats?.edges?.[edgeScope];
  const arr =
    currentlyEmployed === "selected"
      ? edges?.currentlyEmployedTargetNodeIds
      : edges?.targetNodeIds;
  return Array.isArray(arr) ? arr : [];
}

/** For each node, which of `targetIds` let it through: the employers and
 * regions behind a row, so the table can mark them among everything else the
 * row lists.
 *
 * Read off the same arrays the SQL filters match against, and narrowed the
 * same way by `currentlyEmployed`, so what a row marks is exactly what put it
 * on the page - including the current-post rule and the regions folded in
 * above a company, which the browser has no copy of. A node none of them
 * reached is left out rather than given an empty list. */
export function matchedTargets(
  nodes: NodeDoc[],
  targetIds: string[],
  edgeScope: "all" | "approved",
  currentlyEmployed?: string,
): Record<string, string[]> {
  const wanted = new Set(targetIds);
  const matched: Record<string, string[]> = {};
  for (const node of nodes) {
    const hits = memTargets(node, edgeScope, currentlyEmployed).filter((id) =>
      wanted.has(id),
    );
    if (hits.length > 0) matched[node.id] = hits;
  }
  return matched;
}
