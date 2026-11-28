/** Creates `shared/qa/items/<id>.ts` and adds it to `shared/qa/items.ts`.
 *
 *   npm run qa:new -- <id> [--area public|contributor|admin]
 *
 * The entry gets the current Unix time in seconds as its `order`, so it sorts
 * above every entry already on main without anyone editing a shared list. The
 * title, description and steps are left empty, which fails
 * `tests/shared/qa.test.ts` until they are written. */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { QaArea } from "../../shared/qa";
import { ITEMS_DIR, entryIds, readOrder, writeIndex } from "./entries";

const AREAS: QaArea[] = ["public", "contributor", "admin"];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { area: { type: "string", default: "public" } },
});
const [id] = positionals;
const area = values.area as QaArea;

if (!id || positionals.length > 1 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  console.error("usage: npm run qa:new -- <kebab-case-id> [--area <area>]");
  process.exit(1);
}
if (!AREAS.includes(area)) {
  console.error(`--area is one of ${AREAS.join(", ")}`);
  process.exit(1);
}
const file = join(ITEMS_DIR, `${id}.ts`);
if (existsSync(file)) {
  // Ids are never reused: a stored verdict points at it.
  console.error(`shared/qa/items/${id}.ts already exists`);
  process.exit(1);
}

const newest = Math.max(0, ...entryIds().map((other) => readOrder(other)));
const order = Math.max(Math.floor(Date.now() / 1000), newest + 1);

writeFileSync(
  file,
  `import type { QaItem } from "../../qa";

export const order = ${order};

export default {
  id: "${id}",
  title: "",
  description: "",
  steps: [],
  area: "${area}",
} satisfies QaItem;
`,
);
writeIndex();
console.log(`shared/qa/items/${id}.ts`);
