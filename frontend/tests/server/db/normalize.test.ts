import { describe, expect, it } from "vitest";
import {
  emptyReport,
  normalizeDocument,
  readableDate,
} from "../../../server/db/normalize";

describe("normalizeDocument", () => {
  it("turns the legacy shapes into plain JSON and counts each fix", () => {
    const report = emptyReport();
    const doc = normalizeDocument(
      "nodes",
      "p1",
      {
        id: "p1",
        type: "person",
        name: "Anna Nowak",
        parties: { 0: "PiS", 1: "PSL" },
        nameChunksLower: ["a", "an"],
        revision_id: { _path: { segments: ["revisions", "r1"] } },
        birthDate: "2008-28-02",
        content_changed_at: { _seconds: 1, _nanoseconds: 5_000_000 },
        stats: { edges: { all: { targetNodeIds: { 0: "x" } } } },
      },
      report,
    );
    expect(doc).toEqual({
      type: "person",
      name: "Anna Nowak",
      parties: ["PiS", "PSL"],
      revision_id: "revisions/r1",
      birthDate: null,
      content_changed_at: "1970-01-01T00:00:01.005Z",
      stats: { edges: { all: { targetNodeIds: ["x"] } } },
    });
    expect(report.fixes).toEqual({
      "reference->path": 1,
      "timestamp->iso": 1,
      "dropped:nameChunksLower": 1,
      "map->array:parties": 1,
      "map->array:stats.edges.all.targetNodeIds": 1,
      "invalid-date:birthDate": 1,
    });
    expect(report.invalidDates).toEqual([
      {
        collection: "nodes",
        id: "p1",
        field: "birthDate",
        value: "2008-28-02",
      },
    ]);
  });

  it("leaves a map that is not a list alone", () => {
    const doc = normalizeDocument(
      "nodes",
      "p1",
      { votes: { interesting: { total: 1, uid: 1 } } },
      emptyReport(),
    );
    expect(doc.votes).toEqual({ interesting: { total: 1, uid: 1 } });
  });
});

describe("readableDate", () => {
  it.each([
    ["2025", true],
    ["2025-03", true],
    ["2019-02-31", true],
    ["2025-03-14T10:00:00Z", true],
    ["2008-28-02", false],
    ["14.03.2025", false],
  ])("%s -> %s", (value, readable) => {
    expect(readableDate(value)).toBe(readable);
    // The rule `new Date` applies, which the derived stats rely on.
    expect(!isNaN(new Date(value).getTime())).toBe(readable);
  });
});
