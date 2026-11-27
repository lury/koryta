/**
 * Where the readers' queue puts a crop (`priority`, which
 * /api/declarations/next orders by), kept in step with the readings:
 * `cropPriority` over the crop's pages. The ingest writes the number as it
 * stores a crop. After that a reading that reaches a person moves their
 * other open crops to the last tier (`READ_PRIORITY`), and an admin who
 * takes the only reading back moves them back (`requeueCropsPg`). The crops
 * of a page are read in one statement and the moves written in another.
 */
import {
  cropPriority,
  readingPriority,
  readingReached,
} from "../../shared/declarations";
import { pageIsPublic } from "../../shared/model";
import { useDb } from "./client";
import { pagesWithAPublicPostPg } from "./publicPosts";
import { textArray } from "./textArray";

type Data = Record<string, unknown>;

/** A live person page, as far as the queue's order depends on it. */
export type QueuedPage = { id: string; published: boolean; birthDate: unknown };

/** Crops of one page read to tell whether a reading reached it. */
const CROPS_PER_PAGE = 50;

/** The page ids among the values, each once. */
export function pageIdsIn(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter(
        (value): value is string => typeof value === "string" && value !== "",
      ),
    ),
  ];
}

/** The crops that name each page, at most `CROPS_PER_PAGE` each, by id. */
export async function cropsNamingPg(
  pageIds: readonly string[],
): Promise<Map<string, { id: string; data: Data }[]>> {
  const byPage = new Map<string, { id: string; data: Data }[]>();
  for (const id of pageIds) byPage.set(id, []);
  if (pageIds.length === 0) return byPage;
  const rows = await useDb()<{ page: string; id: string; data: Data }[]>`
    SELECT p.id AS page, e.id, e.data
    FROM unnest(${textArray([...pageIds])}::text[]) AS p(id)
    CROSS JOIN LATERAL (
      SELECT id, data FROM declaration_extracts
      WHERE data @> jsonb_build_object('personIds', jsonb_build_array(p.id))
      ORDER BY id LIMIT ${CROPS_PER_PAGE}) e`;
  for (const row of rows)
    byPage.get(row.page)?.push({ id: row.id, data: row.data });
  return byPage;
}

function reached(
  byPage: ReadonlyMap<string, readonly { data: Data }[]>,
  id: string,
): boolean {
  return readingReached(
    (byPage.get(id) ?? []).map((crop) => crop.data),
    id,
  );
}

/** Which of these pages a reading has reached (`readingReached`). */
export async function pagesReachedPg(
  pageIds: readonly string[],
): Promise<Set<string>> {
  const ids = pageIdsIn(pageIds);
  const byPage = await cropsNamingPg(ids);
  return new Set(ids.filter((id) => reached(byPage, id)));
}

/** Each page's tier (`readingPriority`); the drafts' public posts asked at
 * once. */
export async function pageTiersPg(
  pages: Iterable<QueuedPage>,
): Promise<Map<string, 0 | 1 | 2 | 3>> {
  const all = [...pages];
  const drafts = all.filter((page) => !page.published);
  const paid =
    drafts.length > 0
      ? await pagesWithAPublicPostPg(drafts.map((page) => page.id))
      : new Set<string>();
  return new Map(
    all.map((page) => [page.id, readingPriority(page, paid.has(page.id))]),
  );
}

/** The live person pages among the ids, not merged into another. */
async function livePages(
  ids: readonly string[],
): Promise<Map<string, QueuedPage>> {
  if (ids.length === 0) return new Map();
  const rows = await useDb()<{ id: string; data: Data }[]>`
    SELECT id, data FROM nodes
    WHERE id = ANY(${textArray([...ids])}::text[]) AND type = 'person' AND NOT deleted
      AND NOT jsonb_truthy(data -> 'merged_into')`;
  return new Map(
    rows.map(({ id, data }) => [
      id,
      { id, published: pageIsPublic(data), birthDate: data.birthDate },
    ]),
  );
}

/** `requeueCrops`: the open crops of these pages to where the queue should
 * serve them now. How many moved. */
export async function requeueCropsPg(
  pageIds: readonly string[],
): Promise<number> {
  const ids = pageIdsIn(pageIds);
  if (ids.length === 0) return 0;
  const byPage = await cropsNamingPg(ids);
  const open = new Map<string, Data>();
  for (const crops of byPage.values()) {
    for (const crop of crops) {
      if (crop.data.status === "open") open.set(crop.id, crop.data);
    }
  }
  if (open.size === 0) return 0;

  const named = pageIdsIn(
    [...open.values()].flatMap((data) => pageIdsIn(data.personIds)),
  );
  const others = named.filter((id) => !byPage.has(id));
  for (const [id, crops] of await cropsNamingPg(others)) byPage.set(id, crops);
  const pages = await livePages(named);
  const tiers = await pageTiersPg(pages.values());

  const moves: Record<string, number> = {};
  for (const [id, data] of open) {
    const mine = pageIdsIn(data.personIds).filter((page) => pages.has(page));
    if (mine.length === 0) continue;
    const next = cropPriority(
      mine.map((page) => ({
        tier: tiers.get(page) ?? 3,
        read: reached(byPage, page),
        birthDate: pages.get(page)!.birthDate,
      })),
      (data.machine as { birthDate?: unknown } | undefined)?.birthDate,
    );
    if (data.priority !== next) moves[id] = next;
  }
  const count = Object.keys(moves).length;
  if (count === 0) return 0;
  const sql = useDb();
  await sql`
    UPDATE declaration_extracts e
    SET data = jsonb_set(e.data, '{priority}', m.value), updated_at = clock_timestamp()
    FROM jsonb_each(${sql.json(moves)}::jsonb) m
    WHERE e.id = m.key`;
  return count;
}

/** `requeueCropsPg`, never at the caller's expense. */
export async function requeueQuietlyPg(
  pageIds: readonly string[],
): Promise<void> {
  try {
    await requeueCropsPg(pageIds);
  } catch (error) {
    console.error(
      `[declarations] moving the crops of ${pageIds.join(", ")} in the queue failed`,
      error,
    );
  }
}

/** `requeueQuietlyPg` for the people of one crop: the pages it names and
 * those a reading of it reached. */
export async function requeueCropPeoplePg(extractId: string): Promise<void> {
  try {
    const [crop] = await useDb()<{ data: Data }[]>`
      SELECT data FROM declaration_extracts WHERE id = ${extractId}`;
    const outcomes = crop?.data.pageOutcomes;
    await requeueCropsPg([
      ...pageIdsIn(crop?.data.personIds),
      ...(outcomes && typeof outcomes === "object"
        ? Object.keys(outcomes)
        : []),
    ]);
  } catch (error) {
    console.error(
      `[declarations] moving the crops of the people of ${extractId} in the queue failed`,
      error,
    );
  }
}
