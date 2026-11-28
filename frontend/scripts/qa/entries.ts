/** Writes `shared/qa/items.ts`, the list of every file in `shared/qa/items/`.
 *
 *   npm run qa:new -- <id> [--area public|contributor|admin]
 *   npm run qa:index
 *
 * `qa:new` adds an entry and rewrites the list; `qa:index` only rewrites it,
 * which is also how a merge conflict in it is resolved. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SHARED_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../shared",
);
export const ITEMS_DIR = join(SHARED_DIR, "qa/items");
export const INDEX_FILE = join(SHARED_DIR, "qa/items.ts");

/** The ids that have a file, sorted by id. */
export function entryIds(dir = ITEMS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.slice(0, -".ts".length))
    .sort();
}

/** The export name for an id: ids are kebab-case and underscore free, so
 * `_` maps back to `-` without ambiguity. */
export function exportName(id: string): string {
  const name = id.replaceAll("-", "_");
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

export function renderIndex(ids: string[]): string {
  return [
    "// Written by `npm run qa:index` from the files in ./items; do not edit.",
    "// One line per entry, sorted by id, so two branches adding entries touch",
    "// different lines. Order on /qa comes from each file's `order`.",
    ...ids.map((id) => `export * as ${exportName(id)} from "./items/${id}";`),
    "",
  ].join("\n");
}

export function writeIndex(): string[] {
  const ids = entryIds();
  writeFileSync(INDEX_FILE, renderIndex(ids));
  return ids;
}

/** The `order` a file declares. */
export function readOrder(id: string, dir = ITEMS_DIR): number {
  const match = /^export const order = (\d+);$/m.exec(
    readFileSync(join(dir, `${id}.ts`), "utf8"),
  );
  if (!match) throw new Error(`${id}.ts has no \`export const order\``);
  return Number(match[1]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`shared/qa/items.ts: ${writeIndex().length} entries`);
}
