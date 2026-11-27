package processor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"testing"
	"time"

	"github.com/koryta/compressor/internal/config"
	"github.com/parquet-go/parquet-go"
)

func TestEveryArchiveHasAManifestOfWhatItHolds(t *testing.T) {
	ctx := context.Background()
	src, dst := NewMockStorageClient(), NewMockStorageClient()
	bodies := map[string]string{
		"hostname=api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000394808/?rejestr=P/date=2026-05-26": `{"odpis": 1}`,
		"hostname=api-krs.ms.gov.pl/api/krs/Biuletyn/2026-05-25/date=2026-05-26":                 `["bulletin"]`,
		"hostname=api-krs.ms.gov.pl/index/date=2026-05-27":                                       "home",
	}
	for name, body := range bodies {
		src.AddObject(name, int64(len(body)), []byte(body))
	}
	fetched := time.Date(2026, 5, 26, 7, 41, 13, 0, time.UTC)
	for _, obj := range src.Objects {
		obj.Updated = fetched
	}

	dumper := NewDumper(src, dst, &config.Config{Incremental: true})
	if err := dumper.processHostnameIncremental(ctx, "api-krs.ms.gov.pl", "2026-05-28", "2026-05-27"); err != nil {
		t.Fatal(err)
	}

	archive := "hostname=api-krs.ms.gov.pl/from=2025-01-01/date=2026-05-27.tar.zst"
	manifest := dst.file("hostname=api-krs.ms.gov.pl/from=2025-01-01/date=2026-05-27.manifest.parquet")
	if manifest == nil {
		t.Fatalf("No manifest beside %s, wrote %v", archive, dst.WriteTracker)
	}
	rows, err := parquet.Read[manifestRow](bytes.NewReader(manifest), int64(len(manifest)))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != len(bodies) {
		t.Fatalf("Manifest has %d rows, want %d", len(rows), len(bodies))
	}

	tarStream := decompressed(t, dst.file(archive))
	wantURL := map[string]string{
		"hostname=api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000394808/?rejestr=P/date=2026-05-26": "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000394808?rejestr=P",
		"hostname=api-krs.ms.gov.pl/api/krs/Biuletyn/2026-05-25/date=2026-05-26":                 "https://api-krs.ms.gov.pl/api/krs/Biuletyn/2026-05-25",
		"hostname=api-krs.ms.gov.pl/index/date=2026-05-27":                                       "https://api-krs.ms.gov.pl",
	}
	for _, r := range rows {
		body := bodies[r.Name]
		sum := sha256.Sum256([]byte(body))
		switch {
		case r.SHA256 != hex.EncodeToString(sum[:]):
			t.Errorf("%s: sha256 %s", r.Name, r.SHA256)
		case r.Bytes != int64(len(body)) || r.Archive != archive || r.Host != "api-krs.ms.gov.pl":
			t.Errorf("%s: row %+v", r.Name, r)
		case string(tarStream[r.Offset:r.Offset+r.Bytes]) != body:
			t.Errorf("%s: offset %d does not point at its body", r.Name, r.Offset)
		case !r.FetchedAt.Equal(fetched):
			t.Errorf("%s: fetched_at %v", r.Name, r.FetchedAt)
		case r.URL != wantURL[r.Name]:
			t.Errorf("%s: url %q, want %q", r.Name, r.URL, wantURL[r.Name])
		}
	}
}

// A manifest that cannot be stored fails the archive with it, so no archive
// is published without one.
func TestNoArchiveIsPublishedWithoutItsManifest(t *testing.T) {
	ctx := context.Background()
	src, dst := NewMockStorageClient(), NewMockStorageClient()
	src.AddObject("hostname=example.com/date=2026-05-01.json", 4, []byte("data"))
	dst.ErrClose = io.ErrUnexpectedEOF

	dumper := NewDumper(src, dst, &config.Config{Incremental: true})
	if err := dumper.processHostnameIncremental(ctx, "example.com", "2026-05-28", "2026-05-27"); err == nil {
		t.Fatal("Expected the run to fail")
	}
	if len(dst.WriteTracker) != 0 {
		t.Errorf("Expected nothing written, got %v", dst.WriteTracker)
	}
}

func decompressed(t *testing.T, archive []byte) []byte {
	t.Helper()
	r, err := newArchiveReader(bytes.NewReader(archive), "a"+archiveExt)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	b, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
