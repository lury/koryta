import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import { withoutInternalFields } from "~~/server/utils/revisions";
import { editorialTx, readDoc, readDocs } from "~~/server/db/editorial";
import { createRevisionPg } from "~~/server/db/revisionWrites";

const bodyValidator = z.object({
  /** Article node ids to cite. Checked to exist and to be articles. */
  add: z.array(z.string().min(1)).optional(),
  remove: z.array(z.string().min(1)).optional(),
});

/** Attaches or detaches the articles a relation rests on.
 *
 * Takes the ids to add and to remove rather than the whole list, and merges
 * them against what is stored. A caller sending the array it rendered would
 * overwrite whatever was added since it loaded the page, so two people citing
 * the same relation would keep losing each other's source. The merge is a set
 * union, so it is also safe to replay.
 *
 * The write goes through `createRevisionTransaction`, which means the new list
 * lands on the edge document immediately and the revision recording who changed
 * it waits for review. That is how every edge write in the app behaves - only
 * `revision_id` waits for approval, not the data - and for a citation it is the
 * behaviour we want: a source is an annotation on a claim that has already been
 * reviewed, and hiding it until a second person looks would leave the claim on
 * screen with nothing behind it. `stored` is passed so the `set` underneath
 * keeps the edge's `published` flag and its counters.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }

  const body = bodyValidator.parse(await readBody(event));
  const add = body.add ?? [];
  const remove = body.remove ?? [];
  if (add.length === 0 && remove.length === 0) {
    throw createError({
      statusCode: 400,
      message: "Nie podano żadnych źródeł do dodania ani usunięcia.",
    });
  }

  const user = await getUser(event);
  return editorialTx(async (tx, log) => {
    const [stored, added] = await Promise.all([
      readDoc(tx, "edges", id, true),
      readDocs(tx, "nodes", add),
    ]);

    if (!stored) {
      throw createError({ statusCode: 404, message: "Nie ma takiej relacji." });
    }

    // An id that is not an article would sit in `references` forever,
    // resolving to nothing on every page that tries to render it.
    for (const articleId of add) {
      if (added.get(articleId)?.type !== "article") {
        throw createError({
          statusCode: 422,
          message: `Źródło ${articleId} nie jest artykułem w bazie.`,
        });
      }
    }

    const current: string[] = Array.isArray(stored.references)
      ? stored.references
      : [];

    const removing = new Set(remove);
    const references = Array.from(
      new Set([...current.filter((ref) => !removing.has(ref)), ...add]),
    );

    await createRevisionPg(
      tx,
      log,
      user,
      { collection: "edges", id },
      { ...withoutInternalFields(stored), references },
      { stored },
    );
    return { id, references };
  });
});
