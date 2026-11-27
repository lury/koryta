package processor

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/parquet-go/parquet-go"
)

// manifestExt replaces an archive's extension in the name of its manifest:
// hostname=H/from=X/date=Y.manifest.parquet beside hostname=H/from=X/date=Y.tar.zst.
const manifestExt = ".manifest.parquet"

// manifestName is where the manifest of the archive at archiveName goes.
func manifestName(archiveName string) string {
	for _, ext := range []string{archiveExt, legacyArchiveExt} {
		if strings.HasSuffix(archiveName, ext) {
			return strings.TrimSuffix(archiveName, ext) + manifestExt
		}
	}
	return archiveName + manifestExt
}

// manifestRow is one object an archive holds. Offset is where its body starts
// in the uncompressed tar stream.
type manifestRow struct {
	Name string `parquet:"name"`
	URL  string `parquet:"url"`
	Host string `parquet:"host"`
	Day  string `parquet:"day"`
	// When the object was written: its Updated, which every GCS listing the
	// compressor asks for carries.
	FetchedAt time.Time `parquet:"fetched_at,timestamp(millisecond:utc)"`
	SHA256    string    `parquet:"sha256"`
	Bytes     int64     `parquet:"bytes"`
	Archive   string    `parquet:"archive"`
	Offset    int64     `parquet:"offset"`
}

// urlOf is the address a crawl object's name stands for, as
// crawl_blob_name in the pipelines spells it: hostname=H/<path>[/?k=v...]/date=D.
// The name keeps no scheme, so https is assumed; "" when the name is not
// one of a page.
func urlOf(hostname, name string) string {
	rest, ok := strings.CutPrefix(name, "hostname="+hostname+"/")
	if !ok {
		return ""
	}
	i := strings.LastIndex(rest, "/date=")
	if i < 0 || strings.Contains(rest[i+1:], "/") {
		return ""
	}
	var path, query []string
	for _, seg := range strings.Split(rest[:i], "/") {
		if pair, isQuery := strings.CutPrefix(seg, "?"); isQuery {
			query = append(query, strings.ReplaceAll(pair, "%2F", "/"))
		} else {
			path = append(path, seg)
		}
	}
	p := strings.Join(path, "/")
	if p == "index" {
		p = ""
	}
	u := url.URL{Scheme: "https", Host: hostname, Path: "/" + p}
	if p == "" {
		u.Path = ""
	}
	out := u.String()
	if len(query) > 0 {
		out += "?" + strings.Join(query, "&")
	}
	return out
}

// writeManifest publishes the rows of the archive at archiveName as Parquet
// (zstd), and returns only once it is stored.
func (d *Dumper) writeManifest(ctx context.Context, archiveName string, rows []manifestRow) error {
	name := manifestName(archiveName)
	uploadCtx, abort := context.WithCancel(ctx)
	defer abort()
	w := d.outClient.WriteObject(uploadCtx, name)
	pw := parquet.NewGenericWriter[manifestRow](w, parquet.Compression(&parquet.Zstd))
	if _, err := pw.Write(rows); err != nil {
		abort()
		_ = w.Close()
		return fmt.Errorf("failed to write %s: %w", name, err)
	}
	if err := pw.Close(); err != nil {
		abort()
		_ = w.Close()
		return fmt.Errorf("failed to finish %s: %w", name, err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("failed to upload %s: %w", name, err)
	}
	return nil
}
