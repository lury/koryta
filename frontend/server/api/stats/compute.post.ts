import { getEdges } from "~~/shared/graph/util";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import type { Article } from "~~/shared/model";
import type { SourceStat } from "~~/server/api/nodes/articles/index.get";
import { writeDomainArticleStatsPg } from "~~/server/db/domainStats";
import { requireAdmin } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  // A recount reads every article and edge: admins only (decision on
  // 2026-11-27).
  await requireAdmin(event);

  const articles = await fetchNodes("article");
  const [edgesFromDB] = await Promise.all([fetchEdges()]);
  const edges = getEdges(edgesFromDB);

  const articleCounts: Record<string, number> = {};
  const domainMap: Record<string, string> = {}; // domain -> full url sample
  const domainPeople: Record<string, Set<string>> = {};
  const articleToDomain = new Map<string, string>();

  Object.entries(articles).forEach(([id, article]) => {
    const art = article as Article;
    if (!art.sourceURL) return;

    let url: URL;
    try {
      url = new URL(art.sourceURL);
    } catch {
      return; // Invalid URLs are skipped
    }

    const domain = url.hostname.replace("www.", "");

    articleCounts[domain] = (articleCounts[domain] || 0) + 1;
    if (!domainMap[domain]) domainMap[domain] = url.origin;
    if (!domainPeople[domain]) domainPeople[domain] = new Set();

    articleToDomain.set(id, domain);
  });

  edges.forEach((edge) => {
    if (articleToDomain.has(edge.source)) {
      const domain = articleToDomain.get(edge.source)!;
      domainPeople[domain]?.add(edge.target);
    }
    if (articleToDomain.has(edge.target)) {
      const domain = articleToDomain.get(edge.target)!;
      domainPeople[domain]?.add(edge.source);
    }
  });

  const sourceStats: SourceStat[] = Object.entries(domainPeople)
    .sort((a, b) => b[1].size - a[1].size) // Sort desc
    .map(([domain, peopleSet]) => ({
      domain,
      articleCount: articleCounts[domain] || 0,
      peopleCount: peopleSet.size || 0,
      people: Array.from(peopleSet.values()),
      url: domainMap[domain],
    }));

  await writeDomainArticleStatsPg(
    sourceStats.map((stat) => ({
      // The id Firestore was given: the domain with what an id may not hold
      // replaced.
      id: `domain_articles_${stat.domain.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      data: { id: stat.domain, type: "domain_articles", ...stat },
    })),
  );

  return { status: "success", computedDomains: sourceStats.length };
});
