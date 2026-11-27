package processor

import (
	"compress/gzip"
	"fmt"
	"io"
	"regexp"
	"strings"
	"sync"

	"github.com/klauspost/compress/zstd"
)

// The compressor writes tar.zst; archives from before 2026-11-27 are tar.gz,
// and both are read.
const (
	archiveExt       = ".tar.zst"
	legacyArchiveExt = ".tar.gz"
)

// DefaultZstdWindowMB is the zstd window the compressor writes with when the
// config does not say.
const DefaultZstdWindowMB = 8

// maxDecoderWindow is the largest window a reader accepts: zstd's own limit
// for a frame, so whatever the writer was set to can be read back.
const maxDecoderWindow = zstd.MaxWindowSize

// archiveDate captures the date an archive's name ends in, either format.
var archiveDate = regexp.MustCompile(`date=([^.]+)\.tar\.(?:gz|zst)$`)

func isArchive(name string) bool {
	return strings.HasSuffix(name, archiveExt) || strings.HasSuffix(name, legacyArchiveExt)
}

// encoders keeps finished encoders by window size: each holds a window's
// worth of history, which a new one would allocate again for every archive.
var encoders sync.Map // int -> *sync.Pool of *zstd.Encoder

// newArchiveWriter compresses a tar stream into w. windowMB is how far back
// zstd may refer: pages of one host repeat its template, and the 32 KB window
// of gzip did not reach the page before. Hand the encoder back with
// releaseArchiveWriter once it is closed.
func newArchiveWriter(w io.Writer, windowMB int) (*zstd.Encoder, error) {
	if windowMB <= 0 {
		windowMB = DefaultZstdWindowMB
	}
	pool, _ := encoders.LoadOrStore(windowMB, &sync.Pool{})
	if enc, ok := pool.(*sync.Pool).Get().(*zstd.Encoder); ok {
		enc.Reset(w)
		return enc, nil
	}
	return zstd.NewWriter(w,
		zstd.WithEncoderLevel(zstd.SpeedDefault),
		zstd.WithEncoderConcurrency(1),
		zstd.WithWindowSize(windowMB<<20),
	)
}

// releaseArchiveWriter keeps a closed encoder for the next archive.
func releaseArchiveWriter(enc *zstd.Encoder, windowMB int) {
	if windowMB <= 0 {
		windowMB = DefaultZstdWindowMB
	}
	enc.Reset(nil)
	pool, _ := encoders.LoadOrStore(windowMB, &sync.Pool{})
	pool.(*sync.Pool).Put(enc)
}

// newArchiveReader decompresses an archive by the format its name says.
func newArchiveReader(r io.Reader, name string) (io.ReadCloser, error) {
	switch {
	case strings.HasSuffix(name, archiveExt):
		zr, err := zstd.NewReader(r,
			zstd.WithDecoderConcurrency(1),
			zstd.WithDecoderMaxWindow(maxDecoderWindow),
			zstd.WithDecoderLowmem(true),
		)
		if err != nil {
			return nil, fmt.Errorf("not a zstd stream: %w", err)
		}
		return zr.IOReadCloser(), nil
	case strings.HasSuffix(name, legacyArchiveExt):
		gr, err := gzip.NewReader(r)
		if err != nil {
			return nil, fmt.Errorf("not a gzip stream: %w", err)
		}
		return gr, nil
	}
	return nil, fmt.Errorf("%s is not a .tar.zst or .tar.gz archive", name)
}
