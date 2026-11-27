/**
 * The people snapshot on Postgres (server/utils/declarationPeopleCount.ts
 * says what it is): counted whole from the night's facts
 * (`countDeclarationPeoplePg`) and re-staged for the people a daytime event
 * touches (`restageDeclarationPeoplePg`). The meta and the shards are rows of
 * `declaration_people`, locked together for each write so two events at
 * once both land; the snapshot is `stats/declaration_people`.
 */
import {
  arrivedSince,
  countPeople,
  cropRecordOf,
  factsByPage,
  indexCrops,
  isPersonPage,
  namedElsewhere,
  pageBirthDate,
  pagesNamedBy,
  peopleSnapshot,
  publicOtherwise,
  stagePerson,
  type CropRecord,
  type PageNode,
  type PageState,
  type PersonEntry,
  type PublicationState,
} from "../../shared/declarationPeople";
import {
  declarationPeopleSchema,
  peopleStages,
  type DeclarationFactsIngest,
  type DeclarationFactsResult,
  type PeopleStage,
} from "../../shared/declarations";
import { PEOPLE_DOC } from "../utils/declarationPeople";
import {
  entriesOf,
  mergedInto,
  PEOPLE_META,
  PEOPLE_SHARDS,
  publicationOf,
  refuseOlder,
  shardData,
  shardOf,
} from "../utils/declarationPeopleCount";
import { useDb } from "./client";
import { pagesWithAPublicPostPg } from "./publicPosts";
import { textArray } from "./textArray";

type Data = Record<string, unknown>;
type Row = { id: string; data: Data };

const MERGE_HOPS = 8;
const SHARD_IDS = Array.from({ length: PEOPLE_SHARDS }, (_, i) => `shard-${i}`);

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

export type ResolvedPage = { id: string; node: Data | undefined };

/** Each id's page followed through merges, a hop at a time for all at once:
 * at most eight pointers, a cycle stopping at the page it came back to. */
export async function resolvePages(
  ids: Iterable<string>,
): Promise<Map<string, ResolvedPage>> {
  const sql = useDb();
  const wanted = unique(ids);
  const nodes = new Map<string, Data | null>();
  let next = wanted;
  for (let hop = 0; hop <= MERGE_HOPS && next.length > 0; hop++) {
    const rows = await sql<Row[]>`
      SELECT id, data FROM nodes WHERE id = ANY(${textArray(next)}::text[])`;
    const found = new Map(rows.map((row) => [row.id, row.data]));
    for (const id of next) nodes.set(id, found.get(id) ?? null);
    next = unique(
      next.flatMap((id) => {
        const target = mergedInto(nodes.get(id));
        return target && !nodes.has(target) ? [target] : [];
      }),
    );
  }
  const resolved = new Map<string, ResolvedPage>();
  for (const id of wanted) {
    let current = id;
    const seen = new Set([id]);
    for (let hop = 0; hop < MERGE_HOPS; hop++) {
      const target = mergedInto(nodes.get(current));
      if (!target || seen.has(target)) break;
      seen.add(target);
      current = target;
    }
    resolved.set(id, { id: current, node: nodes.get(current) ?? undefined });
  }
  return resolved;
}

/** The shards' entries; a throw when one does not read, which leaves the
 * re-staging to the night's count. */
function shardMaps(rows: readonly Row[]): Map<string, PersonEntry>[] {
  const byId = new Map(rows.map((row) => [row.id, row.data]));
  return SHARD_IDS.map((id) => {
    const { entries, unread } = entriesOf(byId.get(id));
    if (unread > 0) {
      throw new Error(
        `${unread} people entries in ${id} do not read; left for the night's count`,
      );
    }
    return new Map(entries);
  });
}

/** `readPages`: the crops of the pages to re-stage, by the page and by its
 * candidacies, and each page's publication record. */
async function readPages(
  targets: ReadonlyMap<string, PersonEntry>,
  resolved: ReadonlyMap<string, ResolvedPage>,
  factsAt: number,
): Promise<Map<string, PageState | null>> {
  const sql = useDb();
  const pages = [...targets.keys()];
  const keys = unique([...targets.values()].flatMap((entry) => entry.keys));
  const [records, cropRows] = await Promise.all([
    sql<Row[]>`
      SELECT id, data FROM declaration_publications
      WHERE id = ANY(${textArray(pages)}::text[])`,
    sql<Row[]>`
      SELECT id, data FROM declaration_extracts
      WHERE data -> 'personIds' ?| ${textArray(pages)}::text[]
         OR data -> 'candidacyKeys' ?| ${textArray(keys)}::text[]`,
  ]);
  const publications = new Map<string, PublicationState>();
  for (const row of records) {
    const state = publicationOf(row.data);
    if (state) publications.set(row.id, state);
  }
  const crops = new Map<string, CropRecord>(
    cropRows.map((row) => [row.id, cropRecordOf(row.data)]),
  );

  const nodes = new Map<string, Data | undefined>();
  for (const { id, node } of resolved.values()) nodes.set(id, node);
  const others = await resolvePages(
    unique([...crops.values()].flatMap(pagesNamedBy)).filter(
      (id) => !resolved.has(id),
    ),
  );
  const resolve = (id: string) =>
    resolved.get(id)?.id ?? others.get(id)?.id ?? id;
  const index = indexCrops(crops.values(), resolve);

  const states = new Map<string, PageState | null>();
  for (const [page, entry] of targets) {
    const node = nodes.get(page);
    const publication = publications.get(page) ?? null;
    if (
      entry.stage === "published" &&
      node?.published === true &&
      publication === null
    ) {
      continue;
    }
    if (!isPersonPage(node) || publicOtherwise(node, publication)) {
      states.set(page, null);
      continue;
    }
    states.set(page, {
      publication,
      crops: index.byPage.get(page) ?? [],
      birthDate: pageBirthDate(node.birthDate),
      elsewhere: namedElsewhere(page, entry.keys, index),
      arrived: arrivedSince(entry.keys, index, factsAt),
    });
  }
  return states;
}

async function restage(ids: readonly string[], now: Date): Promise<void> {
  const sql = useDb();
  const at = now.getTime();
  const resolved = await resolvePages(ids);
  const finalOf = (id: string) => resolved.get(id)?.id ?? id;
  const wanted = unique(ids.flatMap((id) => [id, finalOf(id)]));
  const shardIds = unique(wanted.map((id) => `shard-${shardOf(id)}`));
  const rows = await sql<Row[]>`
    SELECT id, data FROM declaration_people
    WHERE id = ANY(${textArray([PEOPLE_META, ...shardIds])}::text[])`;
  const meta = rows.find((row) => row.id === PEOPLE_META);
  if (!meta) return;
  const stored = new Map(
    shardMaps(rows.filter((row) => row.id !== PEOPLE_META)).flatMap((map) => [
      ...map,
    ]),
  );
  const partAt = meta.data.partAt;
  const factsAt = typeof partAt === "string" ? Date.parse(partAt) : NaN;

  const gone = ids.filter((id) => finalOf(id) !== id && stored.has(id));
  const targets = new Map<string, PersonEntry>();
  for (const id of ids) {
    const entry = stored.get(finalOf(id));
    if (entry) targets.set(finalOf(id), entry);
  }
  if (targets.size === 0 && gone.length === 0) return;
  const states = await readPages(targets, resolved, factsAt);

  await sql.begin(async (tx) => {
    const locked = await tx<Row[]>`
      SELECT id, data FROM declaration_people
      WHERE id = ANY(${textArray([PEOPLE_META, ...SHARD_IDS])}::text[])
      ORDER BY id FOR UPDATE`;
    if (!locked.some((row) => row.id === PEOPLE_META)) return;
    const maps = shardMaps(locked.filter((row) => row.id !== PEOPLE_META));
    const changed = new Set<number>();
    const entryOf = (page: string) => maps[shardOf(page)]!.get(page);
    for (const page of gone) {
      const entry = entryOf(page);
      if (!entry || entry.at > at) continue;
      maps[shardOf(page)]!.delete(page);
      changed.add(shardOf(page));
    }
    for (const [page, state] of states) {
      const entry = entryOf(page);
      if (!entry || entry.at > at) continue;
      if (state === null) {
        maps[shardOf(page)]!.delete(page);
      } else {
        const { entry: next } = stagePerson({
          candidacies: entry.candidacies,
          band: entry.band,
          page: state,
          now,
          at,
        });
        maps[shardOf(page)]!.set(page, next);
      }
      changed.add(shardOf(page));
    }
    if (changed.size === 0) return;
    const all = maps.flatMap((map) => [...map]);
    const snapshot = declarationPeopleSchema.parse(peopleSnapshot(all, now));
    const data = shardData(all);
    for (const i of changed) {
      await tx`
        INSERT INTO declaration_people (id, data)
        VALUES (${SHARD_IDS[i]!}, ${tx.json(data[i] as never)})
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = clock_timestamp()`;
    }
    await tx`
      INSERT INTO stats (id, data) VALUES (${PEOPLE_DOC}, ${tx.json(snapshot as never)})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = clock_timestamp()`;
  });
}

/** `restageDeclarationPeople`: the counted people among these pages to the
 * stage they are in now. Best effort: a failure is logged, never thrown. */
export async function restageDeclarationPeoplePg(
  pageIds: readonly string[] | undefined,
  now: Date = new Date(),
): Promise<void> {
  const ids = unique(
    (pageIds ?? []).filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
  );
  if (ids.length === 0) return;
  try {
    await restage(ids, now);
  } catch (error) {
    console.error(
      `[declarations] re-staging ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ` and ${ids.length - 5} more` : ""} failed`,
      error,
    );
  }
}

/** `restageCropPeople`: the people of these crops, and any pages besides. */
export async function restageCropPeoplePg(
  extractIds: readonly string[],
  pages: readonly string[] = [],
  now: Date = new Date(),
): Promise<void> {
  const named = [...pages];
  const ids = unique(extractIds.filter((id) => id));
  try {
    if (ids.length > 0) {
      const rows = await useDb()<Row[]>`
        SELECT id, data FROM declaration_extracts WHERE id = ANY(${textArray(ids)}::text[])`;
      for (const row of rows)
        named.push(...pagesNamedBy(cropRecordOf(row.data)));
    }
  } catch (error) {
    console.error(
      `[declarations] reading the pages of ${ids.join(", ")} failed`,
      error,
    );
  }
  await restageDeclarationPeoplePg(named, now);
}

/** A 409 for facts older than the ones counted last, before anything is
 * read (`refuseOlder`). */
export async function refuseOlderFactsPg(
  body: DeclarationFactsIngest,
): Promise<void> {
  const [meta] = await useDb()<Row[]>`
    SELECT id, data FROM declaration_people WHERE id = ${PEOPLE_META}`;
  refuseOlder(meta?.data, body);
}

/**
 * Counts the people snapshot whole from the night's facts, and keeps each
 * person's entry for the re-staging during the day.
 *
 * Reads the list's pages (followed through merges), every publication record
 * and every crop, and which pages have a public post. The writes are one
 * transaction over the meta and every shard, locked, which refuses facts
 * older than the ones counted meanwhile. A person re-staged while this read
 * is re-staged again once it is written: their entry was newer than the
 * count.
 *
 * Runs inside the night's request, so it logs how long it took.
 */
export async function countDeclarationPeoplePg(
  body: DeclarationFactsIngest,
  now: Date,
): Promise<DeclarationFactsResult> {
  const sql = useDb();
  const started = Date.now();
  const [pages, publicationRows, cropRows] = await Promise.all([
    resolvePages(body.candidacies.flatMap((fact) => fact.kids)),
    sql<Row[]>`SELECT id, data FROM declaration_publications ORDER BY id`,
    sql<Row[]>`SELECT id, data FROM declaration_extracts ORDER BY id`,
  ]);
  const crops = cropRows.map((row) => cropRecordOf(row.data));
  const recordPage = (row: Row) => {
    const personId = row.data.personId;
    return typeof personId === "string" && personId ? personId : row.id;
  };
  // Pages the crops and the records name that are no kid of the list: one
  // merged into a page of it is that page's.
  const others = await resolvePages(
    unique([
      ...crops.flatMap(pagesNamedBy),
      ...publicationRows.map(recordPage),
    ]).filter((id) => !pages.has(id)),
  );
  const resolve = (id: string) => pages.get(id)?.id ?? others.get(id)?.id ?? id;

  const nodes = new Map<string, PageNode>();
  for (const { id, node } of pages.values())
    if (node) nodes.set(id, node as PageNode);
  const publications = new Map<string, PublicationState>();
  for (const row of publicationRows) {
    const state = publicationOf(row.data);
    if (state) publications.set(resolve(recordPage(row)), state);
  }
  const byPage = factsByPage(body.candidacies, resolve);
  const publicPosts = await pagesWithAPublicPostPg(
    [...byPage.keys()].filter((page) => isPersonPage(nodes.get(page))),
  );
  const counted = countPeople({
    byPage,
    nodes,
    publicPosts,
    publications,
    crops: indexCrops(crops, resolve),
    factsAt: Date.parse(body.partAt),
    now,
  });
  const snapshot = declarationPeopleSchema.parse(
    peopleSnapshot(counted.entries, now),
  );

  const newer = await sql.begin(async (tx) => {
    const locked = await tx<Row[]>`
      SELECT id, data FROM declaration_people
      WHERE id = ANY(${textArray([PEOPLE_META, ...SHARD_IDS])}::text[])
      ORDER BY id FOR UPDATE`;
    refuseOlder(locked.find((row) => row.id === PEOPLE_META)?.data, body);
    // One that does not read is written over like the rest.
    const restaged = locked
      .filter((row) => row.id !== PEOPLE_META)
      .flatMap((row) =>
        entriesOf(row.data).entries.flatMap(([page, entry]) =>
          entry.at > now.getTime() ? [page] : [],
        ),
      );
    const rows = [
      {
        id: PEOPLE_META,
        data: {
          generation: body.generation,
          listAt: body.listAt,
          part: body.part,
          partAt: body.partAt,
          countedAt: now.toISOString(),
          shards: PEOPLE_SHARDS,
        },
      },
      ...shardData(counted.entries).map((data, i) => ({
        id: SHARD_IDS[i]!,
        data,
      })),
    ];
    await tx`
      INSERT INTO declaration_people (id, data)
      SELECT x.id, x.data FROM jsonb_to_recordset(${tx.json(rows as never)}) AS x(id text, data jsonb)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = clock_timestamp()`;
    await tx`
      INSERT INTO stats (id, data) VALUES (${PEOPLE_DOC}, ${tx.json(snapshot as never)})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = clock_timestamp()`;
    return restaged;
  });
  console.info(
    `[declarations] counted ${snapshot.people} people from ${body.part} ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)} s; ` +
      `left out ${JSON.stringify(counted.leftOut)}`,
  );
  if (newer.length > 0) await restageDeclarationPeoplePg(newer);

  return {
    status: "ok",
    people: snapshot.people,
    stages: Object.fromEntries(
      peopleStages.map((stage) => [stage, snapshot[stage]]),
    ) as Record<PeopleStage, number>,
    unknownReasons: counted.unknownReasons,
  };
}
