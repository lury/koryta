import { getUser } from "~~/server/utils/auth";
import { editorialTx } from "~~/server/db/editorial";
import { ensureArticleNodePg } from "~~/server/db/articles";
import { addArticleMentions } from "~~/server/utils/articleEdges";
import { withHttpScheme } from "~~/shared/url";
import { z } from "zod";

const articleRequestSchema = z.object({
  /** Given a scheme if it was pasted without one, so that what is stored is
   * always an absolute address: a bare `example.pl/a` rendered as an `href`
   * resolves against koryta.pl, and `/api/revisions/create` validates the same
   * field with `.url()`, so a node stored without one could not be edited
   * afterwards without correcting the url in the same pass. */
  url: z
    .string()
    .trim()
    .min(1)
    .transform(withHttpScheme)
    .refine((url) => URL.canParse(url), "Nie wygląda na adres strony."),
  name: z.string().min(1),
  publishedDate: z.string().optional(),
  meta: z.any().optional(),
  /** Nodes this article names, recorded in the same commit as the article.
   *
   * The promotion of a note's source passes the node the note hangs off: a url
   * somebody filed under a person is a claim that the page is about them, and
   * before this the article arrived joined to nothing. Ignored for anything
   * that is not a person or a company - see `addArticleMentions`.
   */
  mentions: z.array(z.string().min(1)).optional(),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    articleRequestSchema.parse(body),
  );
  const user = await getUser(event);
  return editorialTx(async (tx, log) => {
    const { nodeId, created } = await ensureArticleNodePg(tx, log, user, body);
    // In the article's transaction, so a reader never ends up with a page
    // joined to nobody because a second request failed.
    const mentions = await addArticleMentions(
      tx,
      log,
      user,
      nodeId,
      body.mentions ?? [],
    );
    return { nodeId, created, mentions, status: "ok" };
  });
});
