import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QA_ITEMS } from "../../../shared/qa";
import {
  ROLLOUTS_BEFORE_RECORD,
  historyDates,
  recordQaReleases,
  releaseBackend,
  type QaReleaseRecord,
} from "../../../server/utils/qaReleases";

const { store } = vi.hoisted(() => ({
  store: {
    /** The `recordQaReleasesPg` of the case at hand. */
    record: null as unknown as (
      backend: string,
      added: Record<string, string>,
    ) => Promise<Record<string, string>>,
  },
}));

vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));

// The changelog as it will be once somebody adds to it: an entry above the
// history's newest rollout, which only the record can date.
vi.mock("../../../shared/qa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/qa")>();
  return {
    ...actual,
    QA_ITEMS: [
      {
        id: "po-rekordzie",
        title: "Zmiana z pierwszej wersji po rekordzie",
        description: "Opis",
        steps: [],
        area: "public",
      },
      ...actual.QA_ITEMS,
    ],
  };
});
vi.mock("~~/server/db/ops", () => ({
  recordQaReleasesPg: (backend: string, added: Record<string, string>) =>
    store.record(backend, added),
}));

/** `recordQaReleasesPg` over rows by backend, as its SQL does it (checked
 * against Postgres in tests/server/db/opsMail.pg.test.ts): a date already
 * recorded wins, and nothing is written when every entry has one. */
function fakeDb(stored: Record<string, QaReleaseRecord> = {}) {
  const writes: { path: string; data: QaReleaseRecord }[] = [];
  const record = vi.fn(
    async (backend: string, added: Record<string, string>) => {
      const path = `qaReleases/${backend}`;
      const items = { ...stored[path]?.items };
      const missing = Object.fromEntries(
        Object.entries(added).filter(([id]) => !(id in items)),
      );
      if (Object.keys(missing).length > 0) {
        writes.push({ path, data: { items: missing } });
        stored[path] = { items: { ...items, ...missing } };
      }
      return { ...stored[path]?.items };
    },
  );
  store.record = record;
  return { record, writes, stored };
}

const ids = (...list: string[]) => list.map((id) => ({ id }));

describe("ROLLOUTS_BEFORE_RECORD", () => {
  // The history names its rollouts by their newest entry and reads the rest
  // off the order of QA_ITEMS, so an entry it names leaving the list - or the
  // list being reordered under it - would silently redate whole rollouts.
  it("names entries that are still in the changelog, in its order", () => {
    const positions = ROLLOUTS_BEFORE_RECORD.map((rollout) =>
      QA_ITEMS.findIndex((item) => item.id === rollout.newest),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("goes back in time, down to a floor with no date", () => {
    const dated = ROLLOUTS_BEFORE_RECORD.slice(0, -1).map(
      (rollout) => rollout.at!,
    );

    expect(dated.every((at) => !Number.isNaN(Date.parse(at)))).toBe(true);
    expect([...dated].sort().reverse()).toEqual(dated);
    expect(ROLLOUTS_BEFORE_RECORD.at(-1)!.at).toBeNull();
  });

  it("leaves nothing below the newest rollout undated", () => {
    const newest = QA_ITEMS.findIndex(
      (item) => item.id === ROLLOUTS_BEFORE_RECORD[0]!.newest,
    );
    const dates = historyDates(QA_ITEMS);

    expect(QA_ITEMS.slice(newest).every((item) => dates.has(item.id))).toBe(
      true,
    );
    expect(QA_ITEMS.slice(0, newest).some((item) => dates.has(item.id))).toBe(
      false,
    );
  });
});

describe("historyDates", () => {
  const rollouts = [
    { newest: "c", at: "2026-09-25T13:45:39.000Z" },
    { newest: "e", at: "2026-09-18T21:30:20.000Z" },
    { newest: "f", at: null },
  ];

  it("dates every entry by the rollout it arrived with", () => {
    const dates = historyDates(
      ids("a", "b", "c", "d", "e", "f", "g"),
      rollouts,
    );

    expect(Object.fromEntries(dates)).toEqual({
      c: "2026-09-25T13:45:39.000Z",
      d: "2026-09-25T13:45:39.000Z",
      e: "2026-09-18T21:30:20.000Z",
      f: null,
      g: null,
    });
  });

  it("closes over a rollout whose entry has left the list", () => {
    // Its entries fall to the rollout above: dated too late rather than
    // recorded as new today. The test above keeps this from happening.
    const dates = historyDates(ids("a", "c", "d", "f"), [
      rollouts[0]!,
      { newest: "gone", at: "2026-09-18T21:30:20.000Z" },
      rollouts[2]!,
    ]);

    expect(dates.get("d")).toBe("2026-09-25T13:45:39.000Z");
    expect(dates.get("f")).toBeNull();
    expect(dates.has("a")).toBe(false);
  });
});

describe("recordQaReleases", () => {
  const items = ids(
    "new-2",
    "new-1",
    ...ROLLOUTS_BEFORE_RECORD.map((r) => r.newest),
  );

  it("writes down the entries nothing dates yet, as live since the start", async () => {
    const { writes } = fakeDb();

    const record = await recordQaReleases(
      "prod",
      items,
      "2026-09-27T08:00:00.000Z",
    );

    expect(writes).toEqual([
      {
        path: "qaReleases/prod",
        data: {
          items: {
            "new-2": "2026-09-27T08:00:00.000Z",
            "new-1": "2026-09-27T08:00:00.000Z",
          },
        },
      },
    ]);
    expect(record).toEqual({
      "new-2": "2026-09-27T08:00:00.000Z",
      "new-1": "2026-09-27T08:00:00.000Z",
    });
  });

  it("keeps a date already recorded, and writes only what is missing", async () => {
    const { writes, stored } = fakeDb({
      "qaReleases/prod": {
        items: {
          "new-1": "2026-09-27T08:00:00.000Z",
          "left-the-list": "2026-09-26T08:00:00.000Z",
        },
      },
    });

    const record = await recordQaReleases(
      "prod",
      items,
      "2026-09-30T19:00:00.000Z",
    );

    expect(writes).toEqual([
      {
        path: "qaReleases/prod",
        data: { items: { "new-2": "2026-09-30T19:00:00.000Z" } },
      },
    ]);
    expect(record).toEqual({
      "new-2": "2026-09-30T19:00:00.000Z",
      "new-1": "2026-09-27T08:00:00.000Z",
      "left-the-list": "2026-09-26T08:00:00.000Z",
    });
    expect(stored["qaReleases/prod"]!.items).toEqual(record);
  });

  it("writes nothing once every entry is dated", async () => {
    const { writes } = fakeDb({
      "qaReleases/prod": {
        items: {
          "new-2": "2026-09-30T19:00:00.000Z",
          "new-1": "2026-09-27T08:00:00.000Z",
        },
      },
    });

    await recordQaReleases("prod", items, "2026-10-01T08:00:00.000Z");

    expect(writes).toEqual([]);
  });

  it("keeps a record per backend", async () => {
    // autopush rolls out on every push to main, prod by hand days later.
    const { writes } = fakeDb({
      "qaReleases/autopush": {
        items: {
          "new-2": "2026-09-26T10:00:00.000Z",
          "new-1": "2026-09-26T10:00:00.000Z",
        },
      },
    });

    const record = await recordQaReleases(
      "prod",
      items,
      "2026-09-30T19:00:00.000Z",
    );

    expect(writes.map((write) => write.path)).toEqual(["qaReleases/prod"]);
    expect(record["new-1"]).toBe("2026-09-30T19:00:00.000Z");
  });
});

describe("releaseBackend", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["prod", "prod"],
    ["autopush", "autopush"],
    [undefined, "local"],
    ["", "local"],
  ])("reads K_SERVICE %s as %s", (service, backend) => {
    vi.stubEnv("K_SERVICE", service);
    expect(releaseBackend()).toBe(backend);
  });
});

describe("qaReleases", () => {
  // The module keeps its record, and the moment it loaded, for the life of
  // the process, so each case loads it afresh.
  const load = () => import("../../../server/utils/qaReleases");

  // After the newest rollout in the history, as every process that runs
  // this code is: one started before it would list that rollout's entries
  // above the ones it dated itself.
  const STARTED = "2026-11-19T08:00:00.000Z";

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(STARTED));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dates the history's entries by their rollout and the rest by the record", async () => {
    fakeDb();
    const { qaReleases } = await load();

    const releases = await qaReleases();
    const at = (id: string) =>
      releases.find((release) => release.item.id === id)?.at;

    expect(at(ROLLOUTS_BEFORE_RECORD[0]!.newest)).toBe(
      ROLLOUTS_BEFORE_RECORD[0]!.at,
    );
    // The two rollouts of 11-18: one entry, then the sixteen under it down
    // to where the 11-17 one starts.
    expect(at("oswiadczenia-jeden-wycinek-na-osobe")).toBe(
      "2026-11-18T11:35:42.000Z",
    );
    expect(at("statystyki-kafelki")).toBe("2026-11-18T10:50:54.000Z");
    // The rollout of 11-17 brought six entries, down to where the one of
    // 11-04 starts; 11-01's thirteen end above the 10-29 one.
    expect(at("postep-oswiadczen-w-osobach")).toBe("2026-11-17T14:34:28.000Z");
    expect(at("oswiadczenia-odczytaj-date-urodzenia")).toBe(
      "2026-11-01T18:05:34.000Z",
    );
    // The rollout of 10-29 brought three entries: its newest and the two
    // under it, down to where the rollout before it starts.
    expect(at("tabela-dopasowane-firmy")).toBe("2026-10-29T14:43:02.000Z");
    expect(at("wyszukiwania-podpowiedz-udzialy")).toBe(
      "2026-10-29T09:42:29.000Z",
    );
    expect(at("aktywnosc-wykres-30-dni")).toBe("2026-09-25T13:45:39.000Z");
    expect(at("tabela-kontrast-i-kolory")).toBe("2026-08-30T10:17:41.000Z");
    // Nobody knows when the floor's entries went live, so they are not listed.
    expect(at("tabela-firmy-wszystkich-wierszy")).toBeUndefined();
    // No rollout before the record shipped the newest entry: it went live
    // with this process.
    expect(at("po-rekordzie")).toBe(STARTED);
  });

  it("lists newest first, a rollout's entries in the changelog's order", async () => {
    fakeDb();
    const { qaReleases } = await load();

    const releases = await qaReleases();

    const instants = releases.map((release) => release.at);
    expect([...instants].sort().reverse()).toEqual(instants);
    const order = releases.map((release) =>
      QA_ITEMS.findIndex((item) => item.id === release.item.id),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("records once per process", async () => {
    const { record } = fakeDb();
    const { qaReleases, qaReleaseRecord } = await load();

    await qaReleaseRecord();
    await qaReleases();
    await qaReleases();

    expect(record).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failure rather than keeping it", async () => {
    const { record } = fakeDb();
    record.mockRejectedValueOnce(new Error("UNAVAILABLE"));
    const { qaReleases, qaReleaseRecord } = await load();

    await expect(qaReleaseRecord()).rejects.toThrow("UNAVAILABLE");
    const releases = await qaReleases();

    expect(record).toHaveBeenCalledTimes(2);
    expect(releases[0]!.item.id).toBe("po-rekordzie");
  });
});
