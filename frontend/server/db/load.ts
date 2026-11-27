import type { ZodType } from "zod/v4";
import type { Db } from "./client";
import { documentSchemas, unknownCategories } from "../../shared/documents";
import {
  emptyReport,
  normalizeDocument,
  type Doc,
  type NormalizeReport,
} from "./normalize";

/** What a load did to one table. */
export interface TableReport {
  read: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Documents the collection's schema (shared/documents.ts) rejects, kept
   * all the same: the migration reports, it does not refuse. */
  invalid: number;
  /** Issue path -> documents, the most frequent first. */
  issues: Record<string, number>;
  /** A few invalid ids, to look at. */
  invalidExamples: string[];
  unknownCategories: Record<string, number>;
}

/** Collects documents, normalised and checked, and upserts them in batches.
 * Idempotent: a document already stored as it is now is left untouched,
 * which is what `unchanged` counts. */
export class TableLoader {
  readonly report: TableReport = {
    read: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    invalid: 0,
    issues: {},
    invalidExamples: [],
    unknownCategories: {},
  };
  private batch: { id: string; data: Doc }[] = [];

  constructor(
    private sql: Db,
    private collection: string,
    private table: string,
    readonly normalizeReport: NormalizeReport = emptyReport(),
    private batchSize = 1000,
  ) {}

  async add(id: string, raw: Doc): Promise<void> {
    const data = normalizeDocument(
      this.collection,
      id,
      raw,
      this.normalizeReport,
    );
    this.report.read++;
    this.check(id, data);
    this.batch.push({ id, data });
    if (this.batch.length >= this.batchSize) await this.flush();
  }

  private check(id: string, data: Doc) {
    const schema = (documentSchemas as Record<string, ZodType | undefined>)[
      this.collection
    ];
    if (!schema) return;
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      this.report.invalid++;
      if (this.report.invalidExamples.length < 10)
        this.report.invalidExamples.push(id);
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "(document)";
        const key = `${path}: ${issue.code}`;
        this.report.issues[key] = (this.report.issues[key] ?? 0) + 1;
      }
    }
    if (this.collection === "nodes" && data.type === "place") {
      for (const category of unknownCategories(data)) {
        this.report.unknownCategories[category] =
          (this.report.unknownCategories[category] ?? 0) + 1;
      }
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;
    const rows = this.batch;
    this.batch = [];
    const table = this.sql(this.table);
    // A fact without a `createdAt` keeps the one its row was given on an
    // earlier load; a new row gets it from the trigger (0901).
    const data =
      this.table === "extractions"
        ? this
            .sql`CASE WHEN jsonb_instant(x.data -> 'createdAt') IS NULL AND old.id IS NOT NULL
            THEN x.data || jsonb_build_object('createdAt', iso_instant(old.created_at))
            ELSE x.data END`
        : this.sql`x.data`;
    const previous =
      this.table === "extractions"
        ? this.sql`LEFT JOIN extractions old ON old.id = x.id`
        : this.sql``;
    const result = await this.sql<{ inserted: boolean }[]>`
      INSERT INTO ${table} (id, data)
      SELECT x.id, ${data} FROM jsonb_to_recordset(${this.sql.json(rows as never)}) AS x(id text, data jsonb)
      ${previous}
      ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = now()
        WHERE ${table}.data IS DISTINCT FROM excluded.data
      RETURNING (xmax = 0) AS inserted`;
    const inserted = result.filter((r) => r.inserted).length;
    this.report.inserted += inserted;
    this.report.updated += result.length - inserted;
    this.report.unchanged += rows.length - result.length;
  }
}

/** The issues of a report, the most frequent first, at most `limit`. */
export function topIssues(
  issues: Record<string, number>,
  limit = 10,
): [string, number][] {
  return Object.entries(issues)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}
