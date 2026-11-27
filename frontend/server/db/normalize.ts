/** A Firestore document as it is stored in Postgres: plain JSON, with the
 * legacy shapes the inventory found put right, and every fix counted.
 *
 * - Timestamps (the SDK's, or `{_seconds, _nanoseconds}` as they serialise)
 *   and Dates become ISO strings, references their path, bytes
 *   `{"$bytes": base64}`, geo points `{latitude, longitude}`.
 * - Lists stored as maps with numbered keys (`asArray` in shared/model.ts)
 *   become arrays, in the fields known to be lists.
 * - Dates `new Date` cannot read („2008-28-02”) become null; the value is kept
 *   in the report.
 * - `nameChunksLower`, the Firestore search index, is not kept.
 *
 * Used by both loaders (scripts/pg/), so dev data and the migration go
 * through the same rules. */

export type Doc = Record<string, unknown>;

export interface NormalizeReport {
  /** Fix -> how many times it was made. */
  fixes: Record<string, number>;
  /** Every date set to null, with what it held. */
  invalidDates: {
    collection: string;
    id: string;
    field: string;
    value: string;
  }[];
}

export function emptyReport(): NormalizeReport {
  return { fixes: {}, invalidDates: [] };
}

function count(report: NormalizeReport, fix: string) {
  report.fixes[fix] = (report.fixes[fix] ?? 0) + 1;
}

/** Fields that hold lists, per collection, as dotted paths. */
const LIST_FIELDS: Record<string, string[]> = {
  nodes: [
    "parties",
    "categories",
    "activity",
    ...["all", "approved"].flatMap((scope) =>
      [
        "targetNodeIds",
        "currentlyEmployedTargetNodeIds",
        "seatNodeIds",
        "elections",
      ].map((field) => `stats.edges.${scope}.${field}`),
    ),
  ],
  edges: ["references", "member_parties", "backing_parties"],
  notes: ["sources"],
  extractions: ["promotedEdgeIds"],
  declarationPublications: ["extractIds"],
  declarationCandidacies: ["personIds", "kids", "bipUrls"],
};

const DATE_FIELDS: Record<string, string[]> = {
  nodes: ["birthDate"],
  edges: ["start_date", "end_date"],
};

const DROPPED_FIELDS: Record<string, string[]> = {
  nodes: ["nameChunksLower"],
};

/** Whether `new Date(value)` reads it, the way 0002_node_stats.sql's
 * `js_date` does: a year, a month, a day, or an ISO timestamp. */
export function readableDate(value: string): boolean {
  const day = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(value);
  if (day) {
    const month = Number(day[2] ?? "1");
    const date = Number(day[3] ?? "1");
    return month >= 1 && month <= 12 && date >= 1 && date <= 31;
  }
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !isNaN(Date.parse(value));
}

function isNumberedMap(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key, i) => key === String(i));
}

function plain(value: unknown, report: NormalizeReport): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => plain(v, report));
  if (value instanceof Date) {
    count(report, "date->iso");
    return value.toISOString();
  }
  if (value instanceof Uint8Array) {
    count(report, "bytes->base64");
    return { $bytes: Buffer.from(value).toString("base64") };
  }
  const obj = value as Record<string, unknown>;
  // firebase-admin's Timestamp, and the shape it serialises to.
  if (typeof obj.toDate === "function" && "nanoseconds" in obj) {
    count(report, "timestamp->iso");
    return (obj.toDate as () => Date)().toISOString();
  }
  if (
    typeof obj._seconds === "number" &&
    typeof obj._nanoseconds === "number" &&
    Object.keys(obj).length === 2
  ) {
    count(report, "timestamp->iso");
    return new Date(
      obj._seconds * 1000 + Math.floor(obj._nanoseconds / 1e6),
    ).toISOString();
  }
  // DocumentReference: `revision_id` above all, stored as a reference by
  // writers older than `approvedRevisionId`.
  if (typeof obj.path === "string" && "firestore" in obj) {
    count(report, "reference->path");
    return obj.path;
  }
  const segments = (obj._path as { segments?: unknown } | undefined)?.segments;
  if (Array.isArray(segments) && Object.keys(obj).length <= 2) {
    count(report, "reference->path");
    return segments.join("/");
  }
  if (
    typeof obj.latitude === "number" &&
    typeof obj.longitude === "number" &&
    typeof obj.isEqual === "function"
  ) {
    count(report, "geopoint");
    return { latitude: obj.latitude, longitude: obj.longitude };
  }
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, plain(v, report)]),
  );
}

function parentOf(doc: Doc, path: string): [Doc | undefined, string] {
  const parts = path.split(".");
  let at: unknown = doc;
  for (const part of parts.slice(0, -1)) {
    at = (at as Doc | undefined)?.[part];
    if (!at || typeof at !== "object") return [undefined, ""];
  }
  return [at as Doc, parts[parts.length - 1]!];
}

export function normalizeDocument(
  collection: string,
  id: string,
  raw: Doc,
  report: NormalizeReport,
): Doc {
  const dropped = new Set(["id", ...(DROPPED_FIELDS[collection] ?? [])]);
  const doc = Object.fromEntries(
    Object.entries(plain(raw, report) as Doc).filter(([field]) => {
      if (!dropped.has(field)) return true;
      if (field !== "id") count(report, `dropped:${field}`);
      return false;
    }),
  );
  // A revision's `revision_id` is a path like a node's.
  if (
    doc.revision_id &&
    typeof doc.revision_id === "object" &&
    typeof (doc.revision_id as Doc).path === "string"
  ) {
    doc.revision_id = (doc.revision_id as Doc).path;
    count(report, "reference->path");
  }
  for (const path of LIST_FIELDS[collection] ?? []) {
    const [parent, key] = parentOf(doc, path);
    const value = parent?.[key];
    if (parent && isNumberedMap(value)) {
      parent[key] = Object.values(value);
      count(report, `map->array:${path}`);
    }
  }
  for (const field of DATE_FIELDS[collection] ?? []) {
    const value = doc[field];
    if (typeof value === "string" && value !== "" && !readableDate(value)) {
      report.invalidDates.push({ collection, id, field, value });
      doc[field] = null;
      count(report, `invalid-date:${field}`);
    }
  }
  return doc;
}
