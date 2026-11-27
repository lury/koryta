import { getUser } from "~~/server/utils/auth";
import { getNoteRowsPg } from "~~/server/db/notes";
import { normalizeUrl } from "~~/shared/url";
import type { NoteRow } from "~~/shared/model";
import { readNodeDocs } from "~~/server/db/graph";

export type ArticleNotes = { notes: NoteRow[] };

/** What readers have written about this article on other pages.
 *
 * A source somebody files under a person or a company is a note *about that
 * page* which happens to be about this article too - and until now it was only
 * ever visible where it was written. Read from the article, it is the most
 * useful thing on it: several people's reasons for keeping the same piece,
 * beside the piece.
 *
 * Signed in only. Notes on a person are unreviewed claims about a named
 * individual and the entity page already withholds them from logged out
 * readers (`EntityDetailView`); gathering them here without the same gate would
 * publish exactly what that rule exists to hold back. Called with
 * `authRequest`, which unlike `authFetch` attaches the token to a GET - the
 * same way the capture chip on this page is served.
 *
 * Matched two ways. `articleNodeId` is what the promotion stamps on an entry,
 * and is exact. The url is matched normalized as well, which catches the two
 * populations the stamp cannot: entries written before the promotion existed,
 * and the corrections and gap reports, which carry urls and are deliberately
 * never promoted. The entries are read whole (`getNoteRowsPg`) and filtered
 * here, as the admin queue does: the collection is small.
 */
export default defineEventHandler(async (event): Promise<ArticleNotes> => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  await getUser(event);

  const article = (await readNodeDocs([id])).get(id);
  if (article?.type !== "article") {
    throw createError({ statusCode: 404, message: "Nie ma takiego artykułu." });
  }

  const sourceURL = article.sourceURL;
  const wanted =
    typeof sourceURL === "string" && sourceURL ? normalizeUrl(sourceURL) : null;

  const rows = await getNoteRowsPg();
  const notes = rows.filter((row) => {
    // The article's own notes are the editor on the page; this section is what
    // was written elsewhere.
    if (row.nodeId === id) return false;
    if (row.articleNodeId === id) return true;
    return !!wanted && !!row.url && normalizeUrl(row.url) === wanted;
  });

  return { notes };
});
