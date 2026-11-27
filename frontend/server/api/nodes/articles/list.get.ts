import { getValidatedQuery } from "h3";
import { z } from "zod";
import { readPage } from "~~/server/db/graph";

const listQueryValidator = z.object({
  limit: z.coerce.number().default(50),
  page: z.coerce.number().optional(),
});

export default authCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) =>
    listQueryValidator.parse(q),
  );

  const articles = await readPage("nodes", { type: "article", ...query });

  const articleUrls = articles
    .map((data) => data.sourceURL as string | undefined)
    .filter((url): url is string => !!url);

  const notes = await readPage("notes", query);

  const noteUrls = notes
    .flatMap((data) =>
      ((data.sources as { url?: string }[] | undefined) || []).map(
        (s) => s.url,
      ),
    )
    .filter((url): url is string => !!url);

  return {
    articles: Array.from(new Set(articleUrls)),
    notes: Array.from(new Set(noteUrls)),
  };
});
