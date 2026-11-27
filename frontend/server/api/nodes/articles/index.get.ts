import { authCachedEventHandler } from "~~/server/utils/handlers";
import { readWhere } from "~~/server/db/graph";

export type SourceStat = {
  domain: string;
  articleCount: number;
  peopleCount: number;
  people: Array<string>;
  url: string | undefined;
};

export default authCachedEventHandler(async () => {
  const docs = await readWhere("stats", "type", "domain_articles");

  const sourceStats: SourceStat[] = docs.map((data) => {
    return {
      domain: data.domain as string,
      articleCount: data.articleCount as number,
      peopleCount: data.peopleCount as number,
      people: (data.people as string[] | undefined) || [],
      url: data.url as string | undefined,
    };
  });

  // Sort descending by the number of people
  sourceStats.sort((a, b) => b.peopleCount - a.peopleCount);

  return sourceStats;
});
