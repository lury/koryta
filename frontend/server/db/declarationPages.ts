import { createError } from "h3";
import { useDb } from "./client";
import { resolveMergedNodeDoc } from "./graph";
import { pagesWithAPublicPostPg } from "./publicPosts";
import { warsawDate } from "../../shared/dates";
import { pageIsPublic } from "../../shared/model";
import type {
  PersonDeclarationCrops,
  PersonDeclarations,
} from "../../shared/declarations";
import { confirmedDeclarations } from "../utils/declarationMatch";
import {
  cropsOf,
  draftPublicationStatus,
  linkId,
  linksOf,
  LINKS_PER_DAY,
  localWins,
  publicationOf,
  searchesOf,
} from "../utils/declarationPersonCrops";

/** What a person's page shows of their asset declarations, on Postgres:
 * /api/nodes/<id>/declarations (public facts of a public page) and
 * /api/nodes/<id>/declaration-crops (the crops of a draft, for a signed-in
 * reader). */

type Doc = Record<string, unknown>;
type Row = { id: string; data: Doc };

/** A table's documents whose `field` array holds `value`, by id: Firestore's
 * `array-contains`, served by the table's `jsonb_path_ops` index (0401). */
function containing(table: string, field: string, value: string) {
  const sql = useDb();
  return sql<Row[]>`
    SELECT id, data FROM ${sql(table)}
    WHERE data @> ${sql.json({ [field]: [value] })}
    ORDER BY id`;
}

async function publicationRecord(personId: string): Promise<Doc | undefined> {
  const [row] = await useDb()<Row[]>`
    SELECT id, data FROM declaration_publications WHERE id = ${personId}`;
  return row?.data;
}

/** The documents of these ids, in the order given, each once. */
async function extractsInOrder(ids: readonly string[]): Promise<Doc[]> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return [];
  const rows = await useDb()<Row[]>`
    SELECT e.id, e.data
    FROM unnest(${wanted}::text[]) WITH ORDINALITY AS w(id, at)
    JOIN declaration_extracts e ON e.id = w.id
    ORDER BY w.at`;
  return rows.map((row) => row.data);
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

/**
 * The asset declarations a published person's page links, and whether the
 * site published the page itself because of one. Only declarations
 * whose crop still confirms the page's birth date and whose address is a
 * web link. A page that is not public or no person's is a 404 here; one
 * with nothing to show is null.
 */
export async function personDeclarationsPg(
  id: string,
): Promise<PersonDeclarations | null> {
  const { id: personId, data: person } = await resolveMergedNodeDoc(id);
  if (!person || person.type !== "person" || !pageIsPublic(person)) {
    throw createError({ statusCode: 404, message: `No page ${id}` });
  }
  const record = await publicationRecord(personId);
  const shown =
    record?.status === "published" || record?.status === "confirmed";
  const declarations = shown
    ? confirmedDeclarations(
        await extractsInOrder(asStrings(record.extractIds)),
        person,
      ).filter((declaration) => /^https?:\/\//.test(declaration.url))
    : [];
  if (declarations.length === 0) return null;
  return {
    autoPublished:
      record?.status === "published" && record.autoPublished === true
        ? {
            at:
              typeof record.publishedAt === "string" ? record.publishedAt : "",
          }
        : null,
    declarations: declarations.map(({ url, year, unit, office }) => ({
      url,
      year,
      unit,
      office,
    })),
  };
}

/** The draft a page id leads to, through merges: refused as a 404 for a page
 * that is gone, no person's, or public, which says no more of its
 * declarations than the outcome (`/api/nodes/<id>/declarations`). */
export async function draftPersonPg(id: string): Promise<string> {
  const { id: personId, data: person } = await resolveMergedNodeDoc(id);
  if (!person || person.type !== "person" || pageIsPublic(person)) {
    throw createError({ statusCode: 404, message: `No draft ${id}` });
  }
  return personId;
}

/**
 * The crops of one draft's declarations and where its publication stands,
 * for a signed-in reader of the page researching the person by hand. A page
 * with no crop gets the local elections the person won since 2014 instead,
 * each with what the crawler found when it looked for its declaration, and
 * the links readers gave. The pictures stay apart
 * (`/api/declarations/<id>/images`).
 */
export async function personDeclarationCropsPg(
  personId: string,
  /** Who asks: their own links are marked so. */
  uid: string,
): Promise<PersonDeclarationCrops> {
  const [extracts, record] = await Promise.all([
    containing("declaration_extracts", "personIds", personId),
    publicationRecord(personId),
  ]);
  const crops = cropsOf(extracts, personId);
  const sql = useDb();
  const [paidPost, searches, links] = await Promise.all([
    draftPublicationStatus(record) === "held"
      ? pagesWithAPublicPostPg([personId]).then((found) => found.has(personId))
      : false,
    crops.length > 0 ? [] : searchesFor(personId),
    crops.length > 0
      ? []
      : sql<Row[]>`
          SELECT id, data FROM declaration_links
          WHERE data @> ${sql.json({ personId })} ORDER BY id`.then((rows) =>
          linksOf(
            rows.map((row) => row.data),
            uid,
          ),
        ),
  ]);
  return {
    publication: publicationOf(record, paidPost),
    crops,
    searches,
    links,
  };
}

async function searchesFor(personId: string) {
  const sql = useDb();
  const [candidacies, elections] = await Promise.all([
    containing("declaration_candidacies", "personIds", personId),
    sql<Row[]>`
      SELECT id, data FROM edges
      WHERE source = ${personId} AND type = 'election' AND NOT deleted
      ORDER BY id`,
  ]);
  const wins = localWins(elections.map((row) => row.data));
  const regions = [...new Set(wins.map((win) => win.region).filter(Boolean))];
  const names =
    regions.length === 0
      ? []
      : await sql<{ id: string; name: string }[]>`
          SELECT id, jsonb_text(data -> 'name') AS name FROM nodes
          WHERE id = ANY(${regions}::text[])
            AND jsonb_text(data -> 'name') IS NOT NULL`;
  return searchesOf(
    candidacies.map((row) => row.data),
    wins,
    new Map(names.map((row) => [row.id, row.name])),
  );
}

/**
 * Stores a link to the page's declaration a reader found by hand, for the
 * crawl to fetch (`status` "new" until it has). A link the page has already
 * is left as it was, whoever gave it. Past `LINKS_PER_DAY` of this reader's
 * links in the Warsaw day, refused with a 429.
 */
export async function addDeclarationLinkPg(args: {
  personId: string;
  url: string;
  uid: string;
  now?: Date;
}): Promise<"added" | "known"> {
  const now = args.now ?? new Date();
  const day = warsawDate(now);
  const sql = useDb();
  const [today] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM declaration_links
    WHERE data @> ${sql.json({ uid: args.uid, day })}`;
  if ((today?.n ?? 0) >= LINKS_PER_DAY) {
    throw createError({
      statusCode: 429,
      message: "Na dziś przyjęliśmy już tyle Twoich linków, ile możemy.",
    });
  }
  const added = await sql`
    INSERT INTO declaration_links (id, data) VALUES (
      ${linkId(args.personId, args.url)},
      ${sql.json({
        personId: args.personId,
        url: args.url,
        host: new URL(args.url).host,
        uid: args.uid,
        day,
        status: "new",
        createdAt: now.toISOString(),
      })})
    ON CONFLICT (id) DO NOTHING`;
  return added.count > 0 ? "added" : "known";
}
