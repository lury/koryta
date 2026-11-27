import type { ArticleCapture } from "~~/shared/capture";

/** A stored instant, which is ISO text; anything else reads as none. */
function iso(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A stored capture in the shape the client reads.
 *
 * Instants cross as ISO strings.
 */
export function toArticleCapture(
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>,
): ArticleCapture {
  return {
    id,
    url: String(data.url ?? ""),
    normalizedUrl: String(data.normalizedUrl ?? ""),
    domain: String(data.domain ?? ""),
    title: data.title ?? null,
    articleNodeId: data.articleNodeId ?? undefined,
    storagePath: String(data.storagePath ?? ""),
    htmlSha256: String(data.htmlSha256 ?? ""),
    htmlBytes: Number(data.htmlBytes ?? 0),
    selection: data.selection ?? null,
    source: data.source === "paste" ? "paste" : "extension",
    status: data.status ?? "stored",
    capturedBy: String(data.capturedBy ?? ""),
    capturedAt: iso(data.capturedAt),
    updatedAt: iso(data.updatedAt),
    extraction: data.extraction
      ? {
          ...data.extraction,
          startedAt: data.extraction.startedAt
            ? iso(data.extraction.startedAt)
            : undefined,
          finishedAt: data.extraction.finishedAt
            ? iso(data.extraction.finishedAt)
            : undefined,
        }
      : undefined,
  };
}
