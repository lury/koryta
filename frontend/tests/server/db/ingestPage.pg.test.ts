import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type postgres from "postgres";
import handler from "~~/server/api/ingest/page.post";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** POST /api/ingest/page on Postgres: a page a reader captured is filed in
 * the bucket, registered with its article and handed to the extractor; the
 * same bytes twice are one capture.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/ingestPage.pg.test.ts
 */

const { mockSave, dispatchExtraction } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.readValidatedBody = async (
    event: { body?: unknown },
    parse: (b: unknown) => unknown,
  ) => parse(event.body);
  return { mockSave: vi.fn(), dispatchExtraction: vi.fn() };
});
vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({ file: () => ({ save: mockSave }) }),
  }),
}));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("~~/server/utils/extractor", () => ({ dispatchExtraction }));
vi.mock("~~/server/utils/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/utils/auth")>();
  return {
    ...actual,
    getUser: async (event: TestEvent) => {
      const header = event.headers.authorization;
      if (!header) throw Object.assign(new Error("401"), { statusCode: 401 });
      const [uid, ...claims] = header.split(",");
      return { uid, ...Object.fromEntries(claims.map((c) => [c, true])) };
    },
  };
});

type Doc = Record<string, unknown>;
type Answer = Doc & {
  status: string;
  pageId: string;
  duplicate: boolean;
  storagePath: string;
};

const HTML =
  "<html><head><title>Artykuł</title></head><body>treść</body></html>";
const PASSAGE =
  "Prezesem spółki został Jan Kowalski, który wcześniej kierował " +
  "departamentem w ministerstwie.";

const body = (overrides: Doc = {}) => ({
  url: "https://www.example.pl/artykul",
  html: gzipSync(Buffer.from(HTML, "utf8")).toString("base64"),
  htmlEncoding: "gzip-base64",
  title: "Artykuł",
  source: "extension",
  ...overrides,
});

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

async function capture(
  fields: Doc = {},
  as: string | null = "kasia,datascience",
) {
  await store.sync(sql);
  return callAs<Answer>(handler, as ?? undefined, { body: body(fields) });
}

async function page(id: string) {
  const [row] = await sql<{ data: Doc }[]>`
    SELECT data FROM article_pages WHERE id = ${id}`;
  return row?.data;
}

/** A capture of the same bytes, stored earlier. */
function stored(id: string, fields: Doc) {
  table("articlePages")[id] = {
    url: "https://www.example.pl/artykul",
    normalizedUrl: "example.pl/artykul",
    domain: "www.example.pl",
    title: "Artykuł",
    storagePath: "gs://koryta-pl-crawled/old.tar.gz",
    htmlSha256: createHash("sha256").update(HTML).digest("hex"),
    htmlBytes: Buffer.byteLength(HTML),
    source: "extension",
    status: "done",
    capturedBy: "ola",
    capturedAt: "2026-01-01T00:00:00.000Z",
    articleNodeId: "node-9",
    ...fields,
  };
}

describe.runIf(PG_TEST_DATABASE_URL)("POST /api/ingest/page", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("ingest_page");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    mockSave.mockResolvedValue(undefined);
    dispatchExtraction.mockResolvedValue({ dispatched: true });
  });

  it("takes a capture from the datascience group only, of a sane size", async () => {
    expect(await statusOf(capture({}, null))).toBe(401);
    expect(await statusOf(capture({}, "gosc"))).toBe(403);
    expect(
      await statusOf(
        capture({
          html: gzipSync(Buffer.alloc(9 * 1024 * 1024, 0x61)).toString(
            "base64",
          ),
        }),
      ),
    ).toBe(413);
    expect(await statusOf(capture({ selection: "Jan Kowalski" }))).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
    expect(dispatchExtraction).not.toHaveBeenCalled();
  });

  it("files the page, makes its article live and hands it to the extractor", async () => {
    const answer = await capture();
    expect(answer).toMatchObject({
      status: "ok",
      duplicate: false,
      captureStatus: "stored",
      articleNodeCreated: true,
      dispatched: true,
    });
    expect(answer.dispatchError).toBeUndefined();
    expect(await page(answer.pageId)).toMatchObject({
      url: "https://www.example.pl/artykul",
      normalizedUrl: "example.pl/artykul",
      domain: "www.example.pl",
      status: "stored",
      capturedBy: "kasia",
      source: "extension",
      selection: null,
      htmlBytes: Buffer.byteLength(HTML),
      articleNodeId: answer.articleNodeId,
    });
    const [article] = await sql<{ data: Doc }[]>`
      SELECT data FROM nodes WHERE id = ${answer.articleNodeId as string}`;
    expect(article!.data).toMatchObject({
      type: "article",
      name: "Artykuł",
      sourceURL: "https://www.example.pl/artykul",
      published: true,
    });
    expect(dispatchExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: answer.pageId,
        uploaderUid: "kasia",
        contentOverride: undefined,
      }),
    );
  });

  it("reuses the article node a url already has", async () => {
    table("nodes").article = {
      type: "article",
      name: "Artykuł",
      sourceURL: "https://example.pl/artykul/",
      published: true,
    };
    expect(await capture()).toMatchObject({
      articleNodeId: "article",
      articleNodeCreated: false,
    });
  });

  it("answers the stored capture when the same bytes arrive twice", async () => {
    stored("page-old", {});
    expect(await capture()).toMatchObject({
      pageId: "page-old",
      duplicate: true,
      captureStatus: "done",
      articleNodeId: "node-9",
      storagePath: "gs://koryta-pl-crawled/old.tar.gz",
    });
    expect(mockSave).not.toHaveBeenCalled();
    expect(dispatchExtraction).not.toHaveBeenCalled();
  });

  it("runs a passage of a captured page again, on the stored archive", async () => {
    stored("page-whole", { selection: null });
    const answer = await capture({ selection: PASSAGE });
    expect(answer).toMatchObject({
      duplicate: false,
      storagePath: "gs://koryta-pl-crawled/old.tar.gz",
    });
    expect(mockSave).not.toHaveBeenCalled();
    expect(dispatchExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ contentOverride: PASSAGE }),
    );
    expect((await page(answer.pageId))?.selection).toBe(PASSAGE);

    stored("page-passage", { selection: PASSAGE });
    expect(await capture({ selection: PASSAGE })).toMatchObject({
      pageId: "page-passage",
      duplicate: true,
    });
  });

  it("keeps the capture, marked, when the extractor cannot be reached", async () => {
    dispatchExtraction.mockResolvedValue({
      dispatched: false,
      error: "extractor not configured",
    });
    const answer = await capture();
    expect(answer).toMatchObject({
      status: "ok",
      captureStatus: "error",
      dispatched: false,
      dispatchError: "extractor not configured",
    });
    expect(await page(answer.pageId)).toMatchObject({
      status: "error",
      extraction: { error: "extractor not configured" },
    });
  });

  it("files the page where the crawler would have put it", async () => {
    const answer = await capture();
    expect(answer.status).toBe("ok");
    expect(answer.storagePath).toMatch(
      /^gs:\/\/koryta-pl-crawled\/hostname=www\.example\.pl\/date=\d{4}-\d{2}-\d{2}\/uid_.+\.tar\.gz$/,
    );
    // A gzipped tar, not the raw html: the batch parser opens it with tarfile.
    const [archive, options] = mockSave.mock.calls[0]!;
    expect(options.contentType).toBe("application/gzip");
    expect((archive as Buffer).subarray(0, 2)).toEqual(
      Buffer.from([0x1f, 0x8b]),
    );
    expect((await page(answer.pageId))?.storagePath).toBe(answer.storagePath);
  });

  it("accepts html that was not compressed", async () => {
    const answer = await capture({
      html: Buffer.from(HTML, "utf8").toString("base64"),
      htmlEncoding: "base64",
      source: "paste",
    });
    expect(answer.status).toBe("ok");
    expect(await page(answer.pageId)).toMatchObject({
      source: "paste",
      htmlBytes: Buffer.byteLength(HTML),
    });
  });

  it("refuses a url the bucket layout cannot be built from", async () => {
    expect(await statusOf(capture({ url: "not a url" }))).toBe(422);
    expect(mockSave).not.toHaveBeenCalled();
    expect(await sql`SELECT id FROM article_pages`).toHaveLength(0);
  });
});
