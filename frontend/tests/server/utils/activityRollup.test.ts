import { describe, it, expect } from "vitest";
import { emptyActivityCounts } from "../../../shared/activity";
import { DECLARATION_ACTOR } from "../../../shared/declarations";
import type { ActivityEvent } from "../../../server/utils/activityStats";

import {
  dayEndIso,
  dayStartIso,
  mergeRollups,
  mergeTruncated,
  rollupForDay,
  splitSettledDays,
} from "../../../server/utils/activityRollup";

const counts = (partial: Partial<ReturnType<typeof emptyActivityCounts>>) => ({
  ...emptyActivityCounts(),
  ...partial,
});

const event = (
  uid: string,
  kind: ActivityEvent["kind"],
  at: string,
  count?: number,
): ActivityEvent => ({ uid, kind, at, count });

describe("day bounds", () => {
  it("spans exactly one UTC day, half open", () => {
    expect(dayStartIso("2026-08-20")).toBe("2026-08-20T00:00:00.000Z");
    expect(dayEndIso("2026-08-20")).toBe("2026-08-21T00:00:00.000Z");
  });

  it("crosses a month end", () => {
    expect(dayEndIso("2026-08-31")).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("splitSettledDays", () => {
  const days = ["2026-08-18", "2026-08-19", "2026-08-20"];

  it("keeps today live, whatever the hour", () => {
    const { settled, live } = splitSettledDays(
      days,
      new Date("2026-08-20T23:59:00.000Z"),
    );

    expect(settled).toEqual(["2026-08-18", "2026-08-19"]);
    expect(live).toEqual(["2026-08-20"]);
  });

  it("leaves yesterday live until it has settled", () => {
    // Six hours after midnight, a vote stamped by a browser whose clock is a
    // couple of hours behind can still be written into yesterday.
    const { settled, live } = splitSettledDays(
      days,
      new Date("2026-08-20T03:00:00.000Z"),
    );

    expect(settled).toEqual(["2026-08-18"]);
    expect(live).toEqual(["2026-08-19", "2026-08-20"]);
  });

  it("stores yesterday once the window has passed", () => {
    const { settled, live } = splitSettledDays(
      days,
      new Date("2026-08-20T07:00:00.000Z"),
    );

    expect(settled).toEqual(["2026-08-18", "2026-08-19"]);
    expect(live).toEqual(["2026-08-20"]);
  });

  it("splits into a settled prefix and a live suffix, never interleaved", () => {
    const { settled, live } = splitSettledDays(
      days,
      new Date("2026-08-20T12:00:00.000Z"),
    );

    expect([...settled, ...live]).toEqual(days);
  });
});

describe("rollupForDay", () => {
  it("counts a day the same way a live scan would", () => {
    const rollup = rollupForDay(
      "2026-08-20",
      [
        event("anna", "vote", "2026-08-20T09:00:00.000Z"),
        event("anna", "vote", "2026-08-20T18:00:00.000Z"),
        event("bob", "noteSource", "2026-08-20T12:00:00.000Z", 3),
      ],
      [],
    );

    expect(rollup.totals).toEqual(counts({ vote: 2, noteSource: 3 }));
    expect(rollup.contributors.anna).toEqual({
      counts: counts({ vote: 2 }),
      // The latest instant of the day, not the first one seen.
      lastActiveAt: "2026-08-20T18:00:00.000Z",
    });
    expect(rollup.contributors.bob!.counts.noteSource).toBe(3);
  });

  it("leaves the pipeline out, like every other count on the page", () => {
    const rollup = rollupForDay(
      "2026-08-20",
      [event("pipeline-pagerank", "vote", "2026-08-20T09:00:00.000Z")],
      [],
    );

    expect(rollup.contributors).toEqual({});
    expect(rollup.totals.vote).toBe(0);
  });

  it("ignores an event that belongs to another day", () => {
    const rollup = rollupForDay(
      "2026-08-20",
      [event("anna", "vote", "2026-08-19T23:00:00.000Z")],
      [],
    );

    expect(rollup.totals.vote).toBe(0);
  });

  it("keeps what the declarations' automation published apart from everybody", () => {
    const rollup = rollupForDay(
      "2026-08-20",
      [
        event(DECLARATION_ACTOR, "publication", "2026-08-20T09:00:00.000Z"),
        event(DECLARATION_ACTOR, "publication", "2026-08-20T09:01:00.000Z"),
        event("anna", "publication", "2026-08-20T10:00:00.000Z"),
      ],
      [],
    );

    expect(rollup.automatic).toBe(2);
    expect(rollup.totals.publication).toBe(1);
    expect(Object.keys(rollup.contributors)).toEqual(["anna"]);
  });
});

describe("mergeRollups", () => {
  const days = ["2026-08-19", "2026-08-20", "2026-08-21"];
  const rollups = [
    rollupForDay(
      "2026-08-19",
      [
        event("anna", "vote", "2026-08-19T09:00:00.000Z"),
        event("bob", "publication", "2026-08-19T09:00:00.000Z"),
      ],
      [],
    ),
    rollupForDay(
      "2026-08-21",
      [
        event("anna", "revision", "2026-08-21T09:00:00.000Z"),
        event("anna", "vote", "2026-08-21T10:00:00.000Z"),
      ],
      [],
    ),
  ];

  it("adds a contributor's days up and keeps their latest", () => {
    const aggregate = mergeRollups(days, rollups);

    expect(aggregate.contributors[0]).toEqual({
      uid: "anna",
      counts: counts({ vote: 2, revision: 1 }),
      total: 3,
      lastActiveAt: "2026-08-21T10:00:00.000Z",
    });
  });

  it("ranks by total, then by uid so equal totals do not shuffle", () => {
    expect(mergeRollups(days, rollups).contributors.map((c) => c.uid)).toEqual([
      "anna",
      "bob",
    ]);
  });

  it("draws a day with no rollup as a zero column, not as a gap", () => {
    const aggregate = mergeRollups(days, rollups);

    expect(aggregate.daily.map((day) => day.date)).toEqual(days);
    expect(aggregate.daily[1]).toEqual({
      date: "2026-08-20",
      counts: emptyActivityCounts(),
      total: 0,
      automatic: 0,
    });
  });

  it("adds the automation's publications up per day and for the window", () => {
    const automatic = (date: string, count: number) =>
      rollupForDay(
        date,
        Array.from({ length: count }, (_, i) =>
          event(DECLARATION_ACTOR, "publication", `${date}T09:0${i}:00.000Z`),
        ),
        [],
      );
    const aggregate = mergeRollups(days, [
      automatic("2026-08-19", 3),
      automatic("2026-08-21", 2),
    ]);

    expect(aggregate.daily.map((day) => day.automatic)).toEqual([3, 0, 2]);
    expect(aggregate.automatic).toBe(5);
    expect(aggregate.total).toBe(0);
    expect(aggregate.contributors).toEqual([]);
  });

  it("totals the window", () => {
    const aggregate = mergeRollups(days, rollups);

    expect(aggregate.total).toBe(4);
    expect(aggregate.totals).toEqual(
      counts({ vote: 2, publication: 1, revision: 1 }),
    );
  });

  it("counts a day only once, however many rollups mention it", () => {
    // The endpoint appends a live "today" to whatever was stored; if a stored
    // copy of today ever slipped in, its numbers must not be added twice.
    const today = rollupForDay(
      "2026-08-21",
      [event("anna", "revision", "2026-08-21T09:00:00.000Z")],
      [],
    );

    const aggregate = mergeRollups(["2026-08-21"], [today, today]);

    expect(aggregate.total).toBe(1);
  });
});

describe("mergeTruncated", () => {
  it("reports a kind that any day in the window cut short, once", () => {
    const rollups = [
      rollupForDay("2026-08-19", [], ["vote"]),
      rollupForDay("2026-08-20", [], ["vote", "revision"]),
    ];

    expect(mergeTruncated(rollups).sort()).toEqual(["revision", "vote"]);
  });
});
