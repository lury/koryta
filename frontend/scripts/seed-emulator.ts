import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import postgres from "postgres";
import waitOn from "wait-on";

import { collectionTables } from "../server/db/collections";
import { TableLoader } from "../server/db/load";
import { migrate } from "../server/db/migrate";
import { recountBatch } from "../server/db/batch";
import { emptyReport } from "../server/db/normalize";

import nodes from "./nodes.json";
import edges from "./edges.json";
import revisions from "./revisions.json";
import extractions from "./extractions.json";
import { SEEDED_DECLARATION_PEOPLE as declarationPeople } from "./declarationPeople";

const projectId =
  process.env.USE_PROD_PROJECT === "true" ? "koryta-pl" : "demo-koryta-pl";

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = projectId;

const app = initializeApp({
  projectId: projectId,
});

/**
 * Seeds the local stack the dev server and the e2e specs run on: the
 * fixtures into the Postgres at DATABASE_URL (wiped first, then recounted
 * as the night recounts), and the two test accounts into the Auth emulator.
 * With --empty the database is left alone.
 */
async function seed() {
  const empty = process.argv.includes("--empty");
  console.log("empty: ", empty);
  if (!empty) {
    await seedDatabase();
  }
  await seedAuth();
}

/** Gives a fixture the `published` flag it predates.
 *
 * `pageIsPublic` used to fall back to `!!revision_id` when the field was
 * absent, and the fixtures were written against that rule - which is why none
 * of them carries it. Once the fallback was removed (every real document
 * having been backfilled), the seeded site went blank for logged out readers:
 * an absent flag now means "draft", so nothing in it was public and the graph
 * rendered empty.
 *
 * The old rule is reproduced here rather than written into the JSON so the
 * fixtures keep saying one thing about a page - `revision_id` for "somebody
 * approved this" - and a fixture that wants to be a draft can still say
 * `published: false` outright.
 */
function defaultPublished(
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (data.published === undefined) {
    data.published = !!data.revision_id;
  }
  return data;
}

async function seedDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set: start Postgres (docker compose up -d postgres at the repo root) and export it",
    );
  }
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    await migrate(sql);
    console.log("Seeding database...");
    for (const table of Object.values(collectionTables)) {
      await sql`TRUNCATE ${sql(table)}`;
    }

    // Notes on Jan Kowalski (1), one of each kind, so the notes section has
    // something in it to look at.
    //
    // Written by somebody else - `seed-notes-author`, an id no seeded account
    // holds - which is what puts them in `otherSources` rather than in the
    // reader's own note. A signed in reader therefore sees the whole section
    // at once: other people's entries, the prompt inviting theirs, and the
    // three buttons that add one. Owned by the reader it would be their note
    // in edit mode instead, and the prompt would be gone.
    //
    // Only this person. Orlen (2) is deliberately left without any, because
    // the empty section is a state worth a picture of its own and that is the
    // page that takes it.
    const seededNotes = {
      "1_seed-notes-author": {
        nodeId: "1",
        userUid: "seed-notes-author",
        createdAt: "2026-05-04T09:15:00.000Z",
        sources: [
          {
            kind: "source",
            url: "https://example.org/kowalski-rada-nadzorcza",
            note: "Wzmianka o powołaniu do rady nadzorczej - notatka prasowa z maja.",
          },
          {
            kind: "change_request",
            note: "Data końca zatrudnienia w Orlenie wygląda na przesuniętą o rok.",
          },
          {
            kind: "missing",
            note: "Brakuje kadencji w radzie miasta sprzed 2019 roku.",
          },
        ],
      },
    };

    const documents: Partial<
      Record<keyof typeof collectionTables, Record<string, unknown>>
    > = {
      nodes: Object.fromEntries(
        Object.entries(nodes).map(([id, node]) => [
          id,
          defaultPublished({ ...node } as Record<string, unknown>),
        ]),
      ),
      // Ids by position, zero-padded so the id order is the file's: ties are
      // broken on it, and a visual baseline cannot follow a random order.
      edges: Object.fromEntries(
        edges.map((edge, i) => [
          `seededge${String(i).padStart(3, "0")}`,
          defaultPublished({ ...edge } as Record<string, unknown>),
        ]),
      ),
      revisions,
      notes: seededNotes,
      extractions,
      // The seeded reader has answered the mail question already - no to both
      // topics - so the one-time prompt signed-in readers are asked it in
      // (components/mail/OptInPrompt.vue) stays out of every screenshot and
      // spec that signs in as them. mail_campaign.spec.ts asks a fresh
      // account instead.
      users: {
        "test-user": {
          newsletter: { callsToAction: false, recentPeople: false },
        },
      },
      // The declarations job's nightly count in people, which the home
      // explorer's third panel, /oswiadczenia/postep and /admin/oswiadczenia
      // read. Invented numbers that add up the way the real ones must
      // (`declarationPeopleSchema`).
      stats: { declaration_people: declarationPeople },
    };
    const report = emptyReport();
    for (const [collection, docs] of Object.entries(documents)) {
      const loader = new TableLoader(
        sql,
        collection,
        collectionTables[collection as keyof typeof collectionTables],
        report,
      );
      for (const [id, data] of Object.entries(docs!)) {
        await loader.add(id, data as Record<string, unknown>);
      }
      await loader.flush();
      console.log(collection, loader.report.read);
    }
    // The derived statistics the writes keep (node_stats, nodeGroupSize,
    // searchLine, the queue tiers), which the fixtures carry none of.
    await recountBatch(sql);
    console.log("Database seeded successfully!");
  } finally {
    await sql.end();
  }
}

async function seedAuth() {
  await waitOn({
    resources: ["tcp:127.0.0.1:9099"],
    timeout: undefined,
  });
  const auth = getAuth(app);

  if (auth.app.options.projectId !== projectId) {
    throw "this is not a test environment";
  }

  try {
    for (const user of [
      {
        uid: "test-admin",
        email: "admin@koryta.pl",
        password: "password123",
        displayName: "Admin User",
      },
      {
        uid: "test-user",
        email: "user@koryta.pl",
        password: "password123",
        displayName: "Normal User",
      },
    ]) {
      await auth.createUser(user);
      if (user.uid === "test-admin") {
        // datascience: allows uploading extractions via /api/ingest/extraction
        // owner: opens the owner's task list, /admin/zadania
        await auth.setCustomUserClaims(user.uid, {
          admin: true,
          datascience: true,
          owner: true,
        });
        console.log(`Set admin + datascience + owner claim for ${user.email}`);
      }
      console.log(`User created: ${user.email} / ${user.password}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (
      error.code === "auth/email-already-exists" ||
      error.code === "auth/uid-already-exists"
    ) {
      console.log("User already exists", error);
    } else {
      throw error;
    }
  }
}

seed().catch((err) => {
  console.error("Error seeding database:", err);
  process.exit(1);
});
