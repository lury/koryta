/**
 * Fills the emulator with a database the size of production, or a multiple of
 * it, so that the slow paths can be measured on a laptop.
 *
 *   npm run seed:large -- --scale 1 [--base <dir>] [--regions <file>] [--seed 42] [--wipe]
 *   npm run seed:large -- --recount        # stats, through /api/stats/computeNodes
 *   npm run seed:large -- --scale 1 --out <dir>   # files instead of the emulator
 *
 * Sizes follow /api/stats/database on 2026-11-26 (`PROD`). Most people are
 * drafts there, and so they are here: the queue on /eksploruj/nowe reads the
 * drafts, which no public copy can contain.
 *
 * `--base` takes a directory of `nodes-*.jsonl.zst` and `edges.jsonl.zst` as
 * `local_artifacts/tools/scrape_public.py` writes them: the public pages go in
 * as they are and the fake ones fill up to the target counts.
 *
 * `--regions <file>` takes the real regions instead of invented ones: the
 * payloads `data/pipelines` `scripts.region_nodes` writes from TERYT
 * (scripts/pg/teryt-regions.jsonl), ids as production has them. The public
 * copy has no `seat` or `owns` edges, so with `--base` they are drawn again
 * from the regions each public place's stored stats point at.
 *
 * Statistics are not invented here. After loading, `--recount` signs in as the
 * seeded admin and runs the same recount production runs every night, against
 * the dev server on :3000.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore, type BulkWriter } from "firebase-admin/firestore";
import { fakerPL as faker } from "@faker-js/faker";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "fs";
import { join } from "path";
import {
  createZstdCompress,
  zstdDecompressSync,
  type ZstdCompress,
} from "zlib";
import { generateChunksLower } from "../shared/search";
import { companyCategories } from "../shared/companyCategories";
import { accessHeaders, siteUrl } from "./siteHeaders";

const PROD = {
  people: 27655,
  publishedShare: 4394 / 27655,
  places: 12838,
  publicPlaceShare: 6388 / 12838,
  articles: 932,
  edges: 164225,
  voters: 31,
  votedShare: 905 / 27655,
};
/** szpitale's 1,254 of 12,838 places, the largest sector (nodeScan.ts). */
const HOSPITAL_SHARE = 1254 / 12838;
const PARTIES = [
  "PiS",
  "PO",
  "PSL",
  "Lewica",
  "Konfederacja",
  "Polska2050",
  "Inne",
];
const POSTS = [
  "Prezes Zarządu",
  "Członek Zarządu",
  "Przewodniczący Rady Nadzorczej",
  "Członek Rady Nadzorczej",
  "Dyrektor",
  "Zastępca Dyrektora",
  "Prokurent",
];

type Doc = Record<string, unknown>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const projectId = "demo-koryta-pl";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = projectId;
const db = getFirestore(initializeApp({ projectId }), "koryta-pl");

function* readJsonlZst(path: string): Generator<Doc> {
  if (!existsSync(path)) return;
  const raw = readFileSync(path);
  const text = (path.endsWith(".zst") ? zstdDecompressSync(raw) : raw).toString(
    "utf8",
  );
  for (const line of text.split("\n")) if (line.trim()) yield JSON.parse(line);
}

/** What a stored page keeps of a public API row: the fields the site writes,
 * not the ones `/api/nodes` and the recount derive. */
function storedNode(row: Doc): Doc {
  const {
    stats: _s,
    revisions: _r,
    searchLine: _l,
    visibility: _v,
    id: _i,
    ...rest
  } = row;
  return rest;
}

function storedEdge(row: Doc): Doc {
  const { label: _l, traverse: _t, visibility: _v, id: _i, ...rest } = row;
  return { ...rest, published: true };
}

/** An instant in 2026 up to 2026-11-20, fixed by `key` alone. */
function seedInstant(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const day = 86_400_000;
  const days = (Date.UTC(2026, 10, 20) - Date.UTC(2026, 0, 1)) / day;
  return new Date(
    Date.UTC(2026, 0, 1) + (hash % days) * day + ((hash >>> 7) % day),
  ).toISOString();
}

function isoDay(from: string, to: string): string {
  return faker.date.between({ from, to }).toISOString().slice(0, 10);
}

/** Regions as TERYT has them: 16 województwa, their powiaty and gminy, about
 * the 1,389 production holds. Not scaled, there is one Poland. */
function regions(): { id: string; doc: Doc; level: number }[] {
  const out: { id: string; doc: Doc; level: number }[] = [];
  for (let w = 2; w <= 32; w += 2) {
    const ww = String(w).padStart(2, "0");
    out.push({
      id: `teryt${ww}`,
      level: 0,
      doc: {
        type: "region",
        name: `woj. ${faker.location.state()}`,
        teryt: ww,
      },
    });
    for (let p = 1; p <= 20; p++) {
      const pp = `${ww}${String(p).padStart(2, "0")}`;
      out.push({
        id: `teryt${pp}`,
        level: 1,
        doc: {
          type: "region",
          name: `powiat ${faker.location.city()}`,
          teryt: pp,
        },
      });
      for (let g = 1; g <= 3; g++) {
        const gg = `${pp}${String(g).padStart(2, "0")}${faker.helpers.arrayElement(["1", "2", "3"])}`;
        out.push({
          id: `teryt${gg}`,
          level: 2,
          doc: { type: "region", name: faker.location.city(), teryt: gg },
        });
      }
    }
  }
  return out;
}

function placeName(hospital: boolean): string {
  const city = faker.location.city();
  if (hospital) {
    return faker.helpers.arrayElement([
      `Szpital Powiatowy w ${city} Sp. z o.o.`,
      `Wojewódzki Szpital Specjalistyczny im. ${faker.person.fullName()} w ${city}`,
      `Samodzielny Publiczny Zakład Opieki Zdrowotnej w ${city}`,
      `Centrum Medyczne „${faker.word.noun()}” w ${city}`,
    ]);
  }
  const name = faker.company.name().toUpperCase();
  // A few long names, for layouts and the search index.
  return faker.number.float() < 0.02
    ? `${name} ${faker.lorem.words(12).toUpperCase()} SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ`
    : `${name} SP. Z O.O.`;
}

function personName(): string {
  const sex = faker.helpers.arrayElement(["female", "male"] as const);
  const first = faker.person.firstName(sex);
  const last = faker.person.lastName(sex);
  const r = faker.number.float();
  if (r < 0.03) return `${first} ${faker.person.lastName(sex)}-${last}`;
  if (r < 0.05) return `${first} ${faker.person.firstName(sex)} ${last}`;
  return `${first} ${last}`;
}

/** Writes and counts, and keeps a revision beside every page that has one. */
/** Where the documents go: the emulator, or one `<collection>.jsonl.zst` per
 * collection under `--out`, each line `{"id", ...document}`, for loading the
 * same database into something else. */
interface Sink {
  set(collection: string, id: string, doc: Doc): void;
  close(): Promise<void>;
}

class EmulatorSink implements Sink {
  private writer: BulkWriter;
  constructor() {
    // The 500/50/5 ramp-up is there for production; the emulator takes it all.
    this.writer = db.bulkWriter({ throttling: false });
    this.writer.onWriteError((e) => e.failedAttempts < 5);
  }
  set(collection: string, id: string, doc: Doc) {
    void this.writer.set(db.collection(collection).doc(id), doc);
  }
  close() {
    return this.writer.close();
  }
}

class FileSink implements Sink {
  private streams = new Map<string, ZstdCompress>();
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  set(collection: string, id: string, doc: Doc) {
    let stream = this.streams.get(collection);
    if (!stream) {
      stream = createZstdCompress();
      stream.pipe(createWriteStream(join(this.dir, `${collection}.jsonl.zst`)));
      this.streams.set(collection, stream);
    }
    stream.write(JSON.stringify({ id, ...doc }) + "\n");
  }
  async close() {
    await Promise.all(
      [...this.streams.values()].map((s) => new Promise((done) => s.end(done))),
    );
  }
}

class Loader {
  counts: Record<string, number> = {};
  constructor(private sink: Sink) {}

  set(collection: string, id: string, doc: Doc) {
    this.counts[collection] = (this.counts[collection] ?? 0) + 1;
    this.sink.set(collection, id, doc);
  }

  node(id: string, doc: Doc, automatic: boolean) {
    const revisionId = `rev_${id}`;
    const name = typeof doc.name === "string" ? doc.name : "";
    this.set("nodes", id, {
      ...doc,
      revision_id: doc.published ? revisionId : null,
      nameChunksLower: generateChunksLower(name, doc.type as string),
    });
    this.set("revisions", revisionId, {
      node_id: id,
      collection: "nodes",
      data: doc,
      update_time: isoDay("2025-06-01", "2026-11-20") + "T12:00:00Z",
      update_user: automatic ? "pipeline" : "admin@koryta.pl",
      update_automatic: automatic,
    });
  }

  edge(id: string, doc: Doc) {
    this.set("edges", id, doc);
  }
}

async function wipe() {
  for (const name of [
    "nodes",
    "edges",
    "revisions",
    "votes",
    "notes",
    "extractions",
  ]) {
    await db.recursiveDelete(db.collection(name));
    console.log(`wiped ${name}`);
  }
}

/** Region payloads (`RegionPayloads` in data/pipelines), one JSON per line. */
function realRegions(path: string): {
  list: { id: string; doc: Doc; level: number }[];
  edges: { id: string; doc: Doc }[];
} {
  const list: { id: string; doc: Doc; level: number }[] = [];
  const edges: { id: string; doc: Doc }[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const p = JSON.parse(line) as {
      node_id: string;
      name: string;
      teryt: string;
      edge?: { edge_id: string; source: string; target: string; type: string };
    };
    list.push({
      id: p.node_id,
      level: ({ 2: 0, 4: 1 } as Record<number, number>)[p.teryt.length] ?? 2,
      doc: { type: "region", name: p.name, teryt: p.teryt },
    });
    if (p.edge) {
      const { edge_id: id, ...edge } = p.edge;
      edges.push({ id, doc: { ...edge, published: true } });
    }
  }
  return { list, edges };
}

/** A public place's `seat` and `owns` edges, from the regions its stored
 * `targetNodeIds` name: the first powiat is the seat, as the register's seat
 * is a powiat, and any other region an owner. */
function placeRegionEdges(
  row: Doc,
  known: ReadonlySet<string>,
): { id: string; doc: Doc }[] {
  const stats = row.stats as
    { edges?: Record<string, { targetNodeIds?: unknown }> } | undefined;
  const ids = new Set<string>();
  for (const scope of Object.values(stats?.edges ?? {})) {
    if (!Array.isArray(scope.targetNodeIds)) continue;
    for (const id of scope.targetNodeIds as unknown[])
      if (typeof id === "string" && known.has(id)) ids.add(id);
  }
  const sorted = [...ids].sort();
  const seat = sorted.find((id) => id.length === "teryt".length + 4);
  return sorted.map((source) => {
    const type = source === seat ? "seat" : "owns";
    return {
      id: `edge_${source}_${String(row.id)}_${type}`,
      doc: { source, target: row.id, type, published: true },
    };
  });
}

async function generate(
  scale: number,
  base: string | undefined,
  sink: Sink,
  regionsFile?: string,
) {
  const load = new Loader(sink);

  // Invented either way, so that the fake pages after them stay the same.
  let regionList = regions();
  const realRegionData = regionsFile ? realRegions(regionsFile) : undefined;
  if (realRegionData) regionList = realRegionData.list;
  for (const r of regionList)
    load.node(r.id, { ...r.doc, published: true }, true);
  for (const e of realRegionData?.edges ?? []) load.edge(e.id, e.doc);
  const regionIds = new Set(regionList.map((r) => r.id));
  const gminy = regionList.filter((r) => r.level === 2).map((r) => r.id);
  const powiaty = regionList.filter((r) => r.level === 1).map((r) => r.id);

  // The public copy first, so that the fake pages only fill what it lacks.
  const real = {
    person: [] as string[],
    place: [] as string[],
    article: [] as string[],
  };
  if (base) {
    for (const file of readdirSync(base).filter((f) =>
      f.startsWith("nodes-"),
    )) {
      for (const row of readJsonlZst(join(base, file))) {
        const type = row.type as string;
        if (type === "region" || typeof row.id !== "string") continue;
        // The copy's 405 `document` nodes are production's regions as the
        // graph draws them, with the names production gives them.
        if (row.entityType === "region") {
          const { name, teryt } = row;
          load.node(
            row.id,
            { type: "region", name, teryt, published: true },
            true,
          );
          continue;
        }
        load.node(row.id, storedNode(row), false);
        if (type in real) real[type as keyof typeof real].push(row.id);
        if (realRegionData && type === "place") {
          for (const e of placeRegionEdges(row, regionIds))
            load.edge(e.id, e.doc);
        }
      }
    }
    for (const row of readJsonlZst(join(base, "edges.jsonl.zst"))) {
      if (typeof row.id === "string") load.edge(row.id, storedEdge(row));
    }
    console.log(
      "public copy:",
      Object.fromEntries(Object.entries(real).map(([k, v]) => [k, v.length])),
    );
  }

  const target = {
    people: Math.round(PROD.people * scale),
    places: Math.round(PROD.places * scale),
    articles: Math.round(PROD.articles * scale),
  };

  // Places. A hospital is nearly always public, as the register has them, and
  // hospitals are what the slow /eksploruj/nowe query filters on.
  const places: string[] = [...real.place];
  const hospitals: string[] = [];
  const others = companyCategories
    .map((c) => c.value)
    .filter((v) => v !== "szpitale");
  for (let i = real.place.length; i < target.places; i++) {
    const id = `fakeplace${i}`;
    const hospital = faker.number.float() < HOSPITAL_SHARE;
    let categories: unknown = hospital
      ? ["szpitale"]
      : faker.number.float() < 0.2
        ? [faker.helpers.arrayElement(others)]
        : [];
    // The pre-2026-07-28 shape some documents still carry (`asArray`).
    if (faker.number.float() < 0.02)
      categories = { ...(categories as string[]) };
    load.node(
      id,
      {
        type: "place",
        name: placeName(hospital),
        krsNumber: String(
          faker.number.int({ min: 1, max: 1_200_000 }),
        ).padStart(10, "0"),
        categories,
        isPublic: hospital
          ? faker.number.float() < 0.95
          : faker.number.float() < PROD.publicPlaceShare,
        published: true,
      },
      true,
    );
    // Region -> company, as `seat` reads (shared/model.ts).
    load.edge(`fakeseat${i}`, {
      type: "seat",
      source: faker.helpers.arrayElement(gminy),
      target: id,
      published: true,
    });
    // Owners: a powiat for most hospitals, another company now and then.
    if (hospital && faker.number.float() < 0.7) {
      load.edge(`fakeown${i}`, {
        type: "owns",
        source: faker.helpers.arrayElement(powiaty),
        target: id,
        published: true,
      });
    } else if (places.length > 0 && faker.number.float() < 0.05) {
      load.edge(`fakeown${i}`, {
        type: "owns",
        source: faker.helpers.arrayElement(places),
        target: id,
        published: true,
      });
    }
    places.push(id);
    if (hospital) hospitals.push(id);
  }

  // People. Edges per person make up the production total once the places'
  // seats and owners are counted.
  const perPerson =
    (PROD.edges - PROD.places * 1.1 - PROD.articles * 5) / PROD.people;
  const people: string[] = [...real.person];
  const voters = Array.from({ length: PROD.voters }, (_, i) => `voter${i}`);
  const fakePeople: { id: string; published: boolean }[] = [];
  for (let i = real.person.length; i < target.people; i++) {
    const id = `fakeperson${i}`;
    const published = faker.number.float() < PROD.publishedShare;
    const doc: Doc = {
      type: "person",
      name: personName(),
      published,
      parties:
        faker.number.float() < 0.6
          ? faker.helpers.arrayElements(PARTIES, { min: 1, max: 2 })
          : [],
    };
    if (faker.number.float() < 0.45)
      doc.birthDate = isoDay("1945-01-01", "2000-12-31");
    if (faker.number.float() < 0.005) doc.deleted = true;
    load.node(id, doc, !published);

    const jobs = faker.number.int({
      min: 1,
      max: Math.max(1, Math.round(perPerson * 2 - 1)),
    });
    for (let j = 0; j < jobs; j++) {
      // A third of the people hold at least one post in a hospital, so the
      // szpitale filter matches tens of thousands of drafts, as it does live.
      const pool =
        j === 0 && hospitals.length > 0 && faker.number.float() < 0.33
          ? hospitals
          : places;
      const start = isoDay("2000-01-01", "2026-10-31");
      load.edge(`fakejob${i}_${j}`, {
        type: "employed",
        source: id,
        target: faker.helpers.arrayElement(pool),
        name: faker.helpers.arrayElement(POSTS),
        start_date: start,
        end_date:
          faker.number.float() < 0.55 ? null : isoDay(start, "2026-11-20"),
        published,
        revision_id: published ? `rev_${id}` : null,
      });
    }
    if (people.length > 0 && faker.number.float() < 0.2) {
      load.edge(`fakeconn${i}`, {
        type: "connection",
        source: id,
        target: faker.helpers.arrayElement(people),
        published,
      });
    }
    if (faker.number.float() < PROD.votedShare) {
      for (const uid of faker.helpers.arrayElements(voters, {
        min: 1,
        max: 3,
      })) {
        load.set("votes", `${id}_${uid}`, {
          nodeId: id,
          userUid: uid,
          categoryVotes: { interesting: faker.number.int({ min: -5, max: 5 }) },
          updatedAt: new Date().toISOString(),
        });
      }
    }
    people.push(id);
    fakePeople.push({ id, published });
    if (i % 20000 === 0) console.log(`people: ${i}/${target.people}`);
  }

  for (let i = real.article.length; i < target.articles; i++) {
    const id = `fakearticle${i}`;
    load.node(
      id,
      {
        type: "article",
        name: faker.lorem.sentence({ min: 4, max: 12 }),
        sourceURL: faker.internet.url(),
        publishedDate: new Date(isoDay("2015-01-01", "2026-11-20")),
        published: true,
      },
      false,
    );
    for (let j = 0; j < 5; j++) {
      load.edge(`fakementions${i}_${j}`, {
        type: "mentions",
        source: id,
        target: faker.helpers.arrayElement(people),
        published: true,
      });
    }
  }

  // After everything above, so that adding these left the earlier documents
  // as they were for the same seed.
  candidacies(load, fakePeople, regionList);
  modelVotesNotesAndFacts(load, fakePeople);

  await sink.close();
  return load.counts;
}

/** Offices by the level of region they are stood for in. */
const OFFICES: { level: number; position: string; years: string[] }[] = [
  { level: 2, position: "Rada gminy", years: ["2014", "2018", "2024"] },
  { level: 2, position: "Wójt", years: ["2018", "2024"] },
  { level: 1, position: "Rada powiatu", years: ["2014", "2018", "2024"] },
  { level: 0, position: "Sejmik", years: ["2018", "2024"] },
  { level: 0, position: "Sejm", years: ["2015", "2019", "2023"] },
  { level: 0, position: "Parlament Europejski", years: ["2019", "2024"] },
];

/** Candidacies, person -> region, at production's 10,183 per 27,655 people,
 * stored under the election's year the way the PKW import stores them. */
function candidacies(
  load: Loader,
  people: { id: string; published: boolean }[],
  regionList: { id: string; level: number }[],
) {
  const byLevel = [0, 1, 2].map((level) =>
    regionList.filter((r) => r.level === level).map((r) => r.id),
  );
  for (const { id, published } of people) {
    if (faker.number.float() >= 0.3) continue;
    const runs = faker.number.int({ min: 1, max: 2 });
    for (let j = 0; j < runs; j++) {
      const office = faker.helpers.arrayElement(OFFICES);
      const r = faker.number.float();
      const edge: Doc = {
        type: "election",
        source: id,
        target: faker.helpers.arrayElement(byLevel[office.level]!),
        position: office.position,
        start_date: faker.helpers.arrayElement(office.years),
        party: faker.helpers.arrayElement(PARTIES),
        published,
      };
      if (r < 0.3) edge.elected = true;
      else if (r < 0.9) edge.elected = false;
      load.edge(`fakerun${id}_${j}`, edge);
    }
  }
}

/** What the scoring models, the editors' notes and the extracted facts add
 * to a person's statistics, on a few percent of them. */
function modelVotesNotesAndFacts(
  load: Loader,
  people: { id: string; published: boolean }[],
) {
  for (const { id } of people) {
    if (faker.number.float() < 0.05) {
      for (const model of ["pipeline-publishable", "pipeline-pagerank"]) {
        if (faker.number.float() < 0.7)
          load.set("votes", `${id}_${model}`, {
            nodeId: id,
            userUid: model,
            categoryVotes: {
              interesting: faker.number.int({ min: 0, max: 50 }) / 10,
            },
            updatedAt: new Date(
              isoDay("2026-01-01", "2026-11-20"),
            ).toISOString(),
          });
      }
    }
    if (faker.number.float() < 0.01) {
      load.set("notes", `${id}_voter0`, {
        nodeId: id,
        userUid: "voter0",
        createdAt: new Date(isoDay("2026-01-01", "2026-11-20")).toISOString(),
        sources: Array.from(
          { length: faker.number.int({ min: 1, max: 3 }) },
          () => ({ url: faker.internet.url(), note: faker.lorem.sentence() }),
        ),
      });
    }
    if (faker.number.float() < 0.02) {
      for (let k = 0; k < faker.number.int({ min: 1, max: 4 }); k++) {
        load.set("extractions", `fakefact_${id}_${k}`, {
          fact_type: faker.helpers.arrayElement([
            "employment",
            "party_membership",
          ]),
          person: id,
          personNodeId: id,
          articleUrl: faker.internet.url(),
          url: faker.internet.url(),
          justification: faker.lorem.sentence(),
          tag: "seed",
          // From the id, not from faker: another draw would shift everything
          // seeded after it.
          createdAt: seedInstant(`${id}_${k}`),
        });
      }
    }
  }
}

/** The nightly recount, run as the seeded admin against the dev server, or
 * KORYTA_URL with the Access service token (scripts/siteHeaders.ts). */
async function recount() {
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const signIn = await fetch(
    `http://${auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@koryta.pl",
        password: "password123",
        returnSecureToken: true,
      }),
    },
  );
  const { idToken } = (await signIn.json()) as { idToken?: string };
  if (!idToken) throw new Error("sign-in failed: run `npm run seed` first");
  const started = Date.now();
  const res = await fetch(`${siteUrl()}/api/stats/computeNodes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, ...accessHeaders() },
  });
  console.log(res.status, (await res.text()).slice(0, 500));
  console.log(`recount took ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

async function main() {
  if (flag("recount")) return recount();
  const scale = Number(arg("scale") ?? "1");
  faker.seed(Number(arg("seed") ?? "42"));
  const out = arg("out");
  if (flag("wipe") && !out) await wipe();
  const started = Date.now();
  const sink = out ? new FileSink(out) : new EmulatorSink();
  const counts = await generate(scale, arg("base"), sink, arg("regions"));
  console.log(counts, `in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  if (!out) {
    console.log(
      "next: npm run seed:large -- --recount (with the dev server running)",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
