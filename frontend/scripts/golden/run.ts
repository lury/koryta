/**
 * Replays tests/golden/scenario.ts against a running server and compares each
 * answer with its fixture in tests/golden/fixtures; `--record` writes the
 * fixtures instead. The server must be freshly seeded (the scenario writes).
 *
 *   GOLDEN_URL=http://127.0.0.1:3000 GOLDEN_AUTH_URL=http://127.0.0.1:9099 \
 *     npm run test:golden [-- --only <name part>[,<name part>...]] [-- --record]
 *
 * Exit code 1 when anything differs.
 *
 * The server for a recording (postgres-full on thydra): compose.coolify.yaml
 * with SEED_MODE=seed, SEED_SCALE=0.1, profile emulator-auth,
 * FIREBASE_AUTH_EMULATOR_HOST=auth:9099,
 * NUXT_PUBLIC_VUEFIRE_CONFIG_PROJECT_ID=demo-koryta-pl, on an empty volume.
 * Windows relative to today (activity, timeline) and tenures move with the
 * clock: numbers are compared within half a percent, windows are not.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { Masker, differences } from "../../tests/golden/normalize";
import { scenario, type As, type Ctx } from "../../tests/golden/scenario";
import { send, tokens as signIn } from "./client";

const BASE = process.env.GOLDEN_URL ?? "http://127.0.0.1:3000";
const AUTH = process.env.GOLDEN_AUTH_URL ?? "http://127.0.0.1:9099";
const DIR = join(import.meta.dirname, "../../tests/golden/fixtures");
const record = process.argv.includes("--record");
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > 0 ? process.argv[onlyAt + 1]?.split(",") : undefined;
/** Fixtures above this many bytes are stored compressed. */
const COMPRESS_OVER = 256 * 1024;

type Fixture = {
  step: number;
  name: string;
  request: { method: string; path: string; as: As; body?: unknown };
  status: number;
  body: unknown;
};

const slug = (i: number, name: string) =>
  `${String(i).padStart(3, "0")}-${name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()}`;

function readFixtures(): Map<string, Fixture> {
  const out = new Map<string, Fixture>();
  let files: string[];
  try {
    files = readdirSync(DIR);
  } catch {
    return out;
  }
  for (const file of files) {
    const raw = readFileSync(join(DIR, file));
    const text = file.endsWith(".zst")
      ? zstdDecompressSync(raw).toString("utf8")
      : raw.toString("utf8");
    out.set(file.replace(/\.json(\.zst)?$/, ""), JSON.parse(text) as Fixture);
  }
  return out;
}

async function main() {
  const tokens = await signIn(AUTH);
  const fixtures = record ? new Map<string, Fixture>() : readFixtures();
  if (record) mkdirSync(DIR, { recursive: true });
  const masker = new Masker();
  const ctx: Ctx = {};
  let failed = 0;
  let compared = 0;

  for (const [i, step] of scenario.entries()) {
    if (step.waitMs) await new Promise((r) => setTimeout(r, step.waitMs));
    const as = step.as ?? "anon";
    const sent = await send(BASE, step, ctx, tokens);
    const { method, path, body, ms, answer } = sent;
    // Errors carry the server's stack in development; the message is the
    // behaviour.
    if (answer && typeof answer === "object" && "stack" in answer) {
      Reflect.deleteProperty(answer, "stack");
    }
    const fixture: Fixture = {
      step: i,
      name: step.name,
      request: {
        method,
        path: masker.string(path),
        as,
        ...(body === undefined ? {} : { body: masker.value(body) }),
      },
      status: sent.status,
      body: masker.value(answer),
    };
    const key = slug(i, step.name);
    if (only && !only.some((part) => step.name.includes(part))) continue;
    if (record) {
      const json = JSON.stringify(fixture, null, 1) + "\n";
      if (json.length > COMPRESS_OVER) {
        writeFileSync(join(DIR, `${key}.json.zst`), zstdCompressSync(json));
      } else writeFileSync(join(DIR, `${key}.json`), json);
      console.log(
        `${key}: ${sent.status} ${Math.round(ms)} ms, ${json.length} B`,
      );
      continue;
    }
    compared += 1;
    const expected = fixtures.get(key);
    if (!expected) {
      failed += 1;
      console.log(`✗ ${key}: no fixture`);
      continue;
    }
    const order: string[] = [];
    const diffs = [
      ...(expected.status !== fixture.status
        ? [`status ${expected.status} → ${fixture.status}`]
        : []),
      ...differences(
        expected.request,
        fixture.request,
        "request",
        [],
        20,
        order,
      ),
      ...(step.compare === "status"
        ? []
        : differences(expected.body, fixture.body, "body", [], 20, order)),
    ];
    if (diffs.length) {
      failed += 1;
      console.log(
        `✗ ${key} (${Math.round(ms)} ms)\n    ${diffs.join("\n    ")}`,
      );
    } else console.log(`✓ ${key} (${Math.round(ms)} ms)`);
    // Same items, other order: a tie broken the other way. Shown, not failed.
    if (order.length)
      console.log(`    order only: ${order.slice(0, 5).join(", ")}`);
  }
  if (!record) {
    console.log(`${compared - failed}/${compared} steps match`);
    process.exit(failed ? 1 : 0);
  }
}

await main();
