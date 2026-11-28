// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QA_ITEMS } from "../../shared/qa";
import * as entries from "../../shared/qa/items";
import {
  INDEX_FILE,
  entryIds,
  exportName,
  readOrder,
  renderIndex,
} from "../../scripts/qa/entries";
import ORDER_BEFORE_SPLIT from "./qaOrderBeforeSplit.json";

describe("shared/qa/items", () => {
  it("lists every file, as `npm run qa:index` writes it", () => {
    expect(readFileSync(INDEX_FILE, "utf8")).toBe(renderIndex(entryIds()));
  });

  it("names each file after the id of its entry", () => {
    const byName = entries as Record<string, { default: { id: string } }>;
    for (const id of entryIds()) {
      expect(byName[exportName(id)]?.default.id, `${id}.ts`).toBe(id);
    }
    expect(QA_ITEMS).toHaveLength(entryIds().length);
  });

  it("gives every entry its own order", () => {
    const orders = entryIds().map((id) => readOrder(id));
    expect(orders.every((order) => Number.isSafeInteger(order))).toBe(true);
    expect(new Set(orders).size).toBe(orders.length);
  });

  // The entries from the single array kept its order, which is what
  // `historyDates` in server/utils/qaReleases.ts splits rollouts by; anything
  // added since sorts above all of them.
  it("keeps the order the entries had before the split", () => {
    const before = new Set(ORDER_BEFORE_SPLIT);
    const ids = QA_ITEMS.map((item) => item.id);
    const firstOld = ids.findIndex((id) => before.has(id));
    expect(ids.slice(firstOld)).toEqual(
      ORDER_BEFORE_SPLIT.filter((id) => ids.includes(id)),
    );
  });
});
