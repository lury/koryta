import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { articleIdsForTopic } from "~~/server/utils/topics";
import { pageIsPublic } from "~~/shared/model";
import type { Topic } from "~~/shared/model";
import { readNodeDocs } from "~~/server/db/graph";

export type TopicArticle = {
  id: string;
  name: string;
  sourceURL?: string;
  publishedDate?: string | null;
  /** Whether the `tagged` edge putting this article in the story is approved,
   * as opposed to a draft only signed in readers are shown. */
  taggedPublished: boolean;
};

export type TopicDetail = {
  topic: Topic & { id: string };
  articles: TopicArticle[];
};

/** One story: what it is called, and what is in it. */
export default editorFreshCachedEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  const includeDrafts = await wantsLatest(event);

  const topicData = (await readNodeDocs([id])).get(id);

  if (!topicData || topicData.type !== "topic") {
    throw createError({ statusCode: 404, message: "Nie ma takiego tematu." });
  }
  if (!includeDrafts && !pageIsPublic(topicData)) {
    throw createError({ statusCode: 404, message: "Temat nieopublikowany." });
  }

  // Both passes, so that a draft tag can be told apart from an approved one on
  // the page rather than merely being absent.
  const [approvedIds, allIds] = await Promise.all([
    articleIdsForTopic(id, false),
    includeDrafts
      ? articleIdsForTopic(id, true)
      : Promise.resolve<string[]>([]),
  ]);
  const approved = new Set(approvedIds);
  const wanted = includeDrafts ? allIds : approvedIds;

  const found = await readNodeDocs(wanted);
  const docs = wanted.flatMap((articleId) => {
    const data = found.get(articleId);
    return data ? [{ id: articleId, data }] : [];
  });

  const articles: TopicArticle[] = docs
    .filter(({ data }) => data.type === "article")
    .filter(({ data }) => includeDrafts || pageIsPublic(data))
    .map(({ id: articleId, data }) => {
      const date = data.publishedDate;
      return {
        id: articleId,
        name: typeof data.name === "string" ? data.name : "",
        sourceURL:
          typeof data.sourceURL === "string" ? data.sourceURL : undefined,
        publishedDate:
          typeof date === "string" ? new Date(date).toISOString() : null,
        taggedPublished: approved.has(articleId),
      };
    })
    .sort((a, b) =>
      (b.publishedDate ?? "").localeCompare(a.publishedDate ?? ""),
    );

  return {
    topic: { id, ...topicData } as Topic & { id: string },
    articles,
  } satisfies TopicDetail;
});
