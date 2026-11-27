# Compressor (`data/compressor`)

Go job that bundles a host's crawled objects in the bucket into per-day `tar.zst`
archives, each with a `.manifest.parquet` beside it. Run `go test -race ./...` before finishing.

- Stream objects from reader to writer; never `io.ReadAll` an object or a bundle.
  Why: memory must not grow with object size; one large file must not kill the job.
- Compress with zstd. Readers downstream accept both `.gz` and `.zst`.
  Why: better ratio and speed than gzip; old bundles stay readable.
- Work from a manifest of what to process, not by listing the bucket.
  Why: listing is slow and paid per call, grows with the bucket, and is not a stable snapshot.
- Keep Go to this directory; new services use the app's or the pipelines' stack.
  Why: one Go codebase is maintainable, two are a third stack.
- The Dockerfile follows the root Docker rules (pinned images, multi-stage, non-root).
