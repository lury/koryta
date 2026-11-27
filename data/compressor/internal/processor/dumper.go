package processor

import (
	"archive/tar"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"cloud.google.com/go/storage"
	"github.com/koryta/compressor/internal/config"
	"golang.org/x/sync/errgroup"
)

type StorageClient interface {
	ListObjects(ctx context.Context, prefix string) ([]*storage.ObjectAttrs, error)
	// ListObjectsRange lists the objects under prefix named at or after start
	// and before end, in name order; an empty start or end leaves that side open.
	ListObjectsRange(ctx context.Context, prefix, start, end string) ([]*storage.ObjectAttrs, error)
	// ListObjectsGlob lists the objects under prefix whose whole names match
	// a GCS match glob, in name order.
	ListObjectsGlob(ctx context.Context, prefix, glob string) ([]*storage.ObjectAttrs, error)
	ListPrefixes(ctx context.Context, prefix string) ([]string, error)
	ReadObject(ctx context.Context, name string) (io.ReadCloser, error)
	WriteObject(ctx context.Context, name string) io.WriteCloser
	ObjectExists(ctx context.Context, name string) (bool, error)
}

type Dumper struct {
	client    StorageClient
	outClient StorageClient
	cfg       *config.Config
}

func NewDumper(client, outClient StorageClient, cfg *config.Config) *Dumper {
	return &Dumper{
		client:    client,
		outClient: outClient,
		cfg:       cfg,
	}
}

type FileInfo struct {
	Name     string
	Hostname string
	Date     string
	Size     int64
	// Updated is when the object was written: when the page was fetched.
	Updated time.Time
}

func (d *Dumper) Run(ctx context.Context) error {
	log.Println("Starting discovery...")

	now := time.Now().UTC()
	today := now.Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")

	var hostnames []string

	if d.cfg.Hostname != "" {
		// Discovery walks every hostname prefix in the bucket, which is most of
		// the run when only one host is wanted. Named explicitly, skip it.
		hostnames = []string{d.cfg.Hostname}
		log.Printf("Restricted to hostname %s", d.cfg.Hostname)
	} else {
		log.Println("Discovering hostnames...")
		prefixes, err := d.client.ListPrefixes(ctx, d.cfg.SourcePrefix+"hostname=")
		if err != nil {
			return fmt.Errorf("failed to list hostnames: %w", err)
		}

		for _, p := range prefixes {
			// p is like "hostname=example.com/"
			parts := strings.Split(strings.TrimSuffix(p, "/"), "=")
			if len(parts) == 2 {
				hostnames = append(hostnames, parts[1])
			}
		}
		log.Printf("Found %d hostnames", len(hostnames))
	}

	// Worker pool
	numWorkers := d.cfg.HostWorkers
	if numWorkers <= 0 {
		numWorkers = 5
	}
	if len(hostnames) < numWorkers {
		numWorkers = len(hostnames)
	}
	if numWorkers == 0 {
		log.Println("No hostnames found. Run completed successfully.")
		return nil
	}

	workCh := make(chan string, len(hostnames))
	for _, h := range hostnames {
		workCh <- h
	}
	close(workCh)

	var wg sync.WaitGroup
	errCh := make(chan error, len(hostnames))

	var processedCount int32
	totalHostnames := int32(len(hostnames))

	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for hostname := range workCh {
				var err error
				if d.cfg.Incremental {
					err = d.processHostnameIncremental(ctx, hostname, today, yesterday)
				} else {
					err = d.processHostname(ctx, hostname, today)
				}

				if err != nil {
					err = fmt.Errorf("failed processing %s: %w", hostname, err)
					log.Println(err)
					errCh <- err
				}

				current := atomic.AddInt32(&processedCount, 1)
				if current%50 == 0 || current == totalHostnames {
					log.Printf("Progress: %d/%d hostnames scanned (%.1f%%)", current, totalHostnames, float64(current)/float64(totalHostnames)*100)
				}
			}
		}()
	}

	wg.Wait()
	close(errCh)

	var errs []error
	for err := range errCh {
		errs = append(errs, err)
	}
	if len(errs) > 0 {
		// Each one was logged as it happened. Returning them is what makes the
		// process exit non-zero, so a scheduled run that lost hosts shows up
		// as failed rather than as a quiet line in its log.
		return fmt.Errorf("%d of %d hostnames failed: %w", len(errs), len(hostnames), errors.Join(errs...))
	}

	log.Println("Run completed successfully")
	return nil
}

func (d *Dumper) processHostname(ctx context.Context, hostname, today string) error {
	// Find what's already processed for THIS hostname in the output bucket
	processed := make(map[string]bool)
	dumpsPrefix := fmt.Sprintf("hostname=%s/", hostname)
	dumpObjects, err := d.outClient.ListObjects(ctx, dumpsPrefix)
	if err != nil {
		return err
	}

	// Dump format: hostname=<hostname>/date=<date>.tar.zst (.tar.gz before)
	for _, obj := range dumpObjects {
		matches := archiveDate.FindStringSubmatch(obj.Name)
		if len(matches) == 2 {
			processed[matches[1]] = true
		}
	}

	// List files for this hostname in the source bucket
	sourcePrefix := fmt.Sprintf("%shostname=%s/", d.cfg.SourcePrefix, hostname)
	sourceObjects, err := d.listSource(ctx, sourcePrefix, dumpObjects)
	if err != nil {
		return err
	}

	// Regex stops matching at the slash or dot so it captures just the date
	sourceRegex := regexp.MustCompile(`date=([^/.]+)`)
	byDate := make(map[string][]FileInfo)

	for _, obj := range sourceObjects {
		matches := sourceRegex.FindStringSubmatch(obj.Name)
		if len(matches) != 2 {
			continue
		}
		date := matches[1]

		if date == today || processed[date] {
			continue
		}

		info := FileInfo{
			Name:     obj.Name,
			Hostname: hostname,
			Date:     date,
			Size:     obj.Size,
			Updated:  obj.Updated,
		}

		byDate[date] = append(byDate[date], info)
	}

	if len(byDate) > 0 {
		log.Printf("Hostname %s: found %d new dates to archive", hostname, len(byDate))
	}

	// Generate missing hostname dumps
	g, gCtx := errgroup.WithContext(ctx)

	compressWorkers := d.cfg.CompressWorkers
	if compressWorkers <= 0 {
		return fmt.Errorf("Number of compress workers is negative: %d", compressWorkers)
	}
	g.SetLimit(compressWorkers) // Max concurrent date dumps per hostname to prevent excessive memory usage

	for date, files := range byDate {
		date := date
		files := files
		g.Go(func() error {
			if err := d.processDump(gCtx, hostname, date, files); err != nil {
				return err
			}
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return err
	}

	return nil
}

func (d *Dumper) processHostnameIncremental(ctx context.Context, hostname, today, yesterday string) error {
	archives, maxDumpDate, err := d.incrementalArchives(ctx, hostname)
	if err != nil {
		return err
	}

	fromDate := "2025-01-01"
	if maxDumpDate != "" {
		fromDate = maxDumpDate
	}

	// If the fromDate is somehow today or later, we shouldn't create a dump.
	if fromDate >= yesterday {
		log.Printf("Hostname %s: fromDate %s is >= yesterday %s, skipping", hostname, fromDate, yesterday)
		return nil
	}

	destPath := fmt.Sprintf("hostname=%s/from=%s/date=%s%s", hostname, fromDate, yesterday, archiveExt)

	exists, err := d.outClient.ObjectExists(ctx, destPath)
	if err != nil {
		return err
	}
	if exists && !d.cfg.DryRun {
		log.Printf("Incremental dump %s already exists, skipping", destPath)
		return nil
	}

	// List files for this hostname in the source bucket
	sourcePrefix := fmt.Sprintf("%shostname=%s/", d.cfg.SourcePrefix, hostname)
	var sourceObjects []*storage.ObjectAttrs
	if days := daysAfter(fromDate, yesterday); maxDumpDate != "" && len(days) <= maxGlobDays {
		sourceObjects, err = d.listDays(ctx, sourcePrefix, days)
	} else {
		sourceObjects, err = d.listSource(ctx, sourcePrefix, archives)
	}
	if err != nil {
		return err
	}

	sourceRegex := regexp.MustCompile(`date=([^/.]+)`)
	var allFiles []FileInfo

	for _, obj := range sourceObjects {
		matches := sourceRegex.FindStringSubmatch(obj.Name)
		if len(matches) != 2 {
			continue
		}
		date := matches[1]

		if date == today {
			continue
		}

		if date < "2025-01-01" {
			return fmt.Errorf("found file with date older than 2025-01-01: %s (date: %s)", obj.Name, date)
		}

		if date > fromDate && date <= yesterday {
			allFiles = append(allFiles, FileInfo{
				Name:     obj.Name,
				Hostname: hostname,
				Date:     date,
				Size:     obj.Size,
				Updated:  obj.Updated,
			})
		}
	}

	if len(allFiles) == 0 {
		log.Printf("Hostname %s: no new data since %s, skipping", hostname, fromDate)
		return nil
	}

	log.Printf("Hostname %s: found %d files for incremental dump from %s up to %s", hostname, len(allFiles), fromDate, yesterday)

	// Create dump
	var fileList []string
	for _, f := range allFiles {
		fileList = append(fileList, f.Name)
	}
	indexContent := strings.Join(fileList, "\n") + "\n"

	return d.createArchive(ctx, destPath, allFiles, indexContent)
}

// incrementalArchives lists the hostname's from=/date= archives, and the date
// the newest of them archives up to, "" when there is none.
func (d *Dumper) incrementalArchives(ctx context.Context, hostname string) ([]*storage.ObjectAttrs, string, error) {
	prefix := fmt.Sprintf("hostname=%s/from=", hostname)
	objects, err := d.outClient.ListObjects(ctx, prefix)
	if err != nil {
		return nil, "", err
	}

	maxDate := ""
	for _, obj := range objects {
		matches := archiveDate.FindStringSubmatch(obj.Name)
		if len(matches) == 2 {
			if maxDate == "" || matches[1] > maxDate {
				maxDate = matches[1]
			}
		}
	}
	return objects, maxDate, nil
}

func (d *Dumper) processDump(ctx context.Context, hostname, date string, files []FileInfo) error {
	destPath := fmt.Sprintf("hostname=%s/date=%s%s", hostname, date, archiveExt)

	// List of files/dates included
	var fileList []string
	for _, f := range files {
		fileList = append(fileList, f.Name)
	}

	indexContent := strings.Join(fileList, "\n") + "\n"

	return d.createArchive(ctx, destPath, files, indexContent)
}

// openedFile is a source object whose download has started: the writer
// streams it into the archive and closes it.
type openedFile struct {
	file FileInfo
	body io.ReadCloser
}

// createArchive uploads files to destPath as one tar.zst, with indexContent
// as its first member, index.txt. Either the whole archive is published or
// nothing is.
func (d *Dumper) createArchive(ctx context.Context, destPath string, files []FileInfo, indexContent string) error {
	if d.cfg.DryRun {
		log.Printf("[DRY-RUN] Would create %s with %d files", destPath, len(files))
		return nil
	}

	log.Printf("Creating %s...", destPath)
	timeNow := time.Now().UTC()

	// Closing a GCS writer publishes whatever was written to it, and the next
	// incremental run starts after the newest archive it finds, so a truncated
	// archive would hide the objects it is missing for good. The only way to
	// abandon an upload is to cancel the context the writer was opened with,
	// so a failure does that before the writer is closed.
	uploadCtx, abortUpload := context.WithCancel(ctx)
	defer abortUpload()
	w := d.outClient.WriteObject(uploadCtx, destPath)

	rows, err := d.writeArchive(ctx, w, destPath, files, indexContent)
	if err == nil {
		// Before the archive is published, so that no archive is without
		// one; a manifest whose archive then fails is rewritten by the run
		// that writes the archive.
		err = d.writeManifest(ctx, destPath, rows)
	}
	if err != nil {
		abortUpload()
		_ = w.Close() // Waits for the abandoned upload; err already says why.
		log.Printf("Abandoned %s, nothing was published", destPath)
		return err
	}
	// Close is where GCS reports how the upload went. An archive smaller than
	// the writer's 16 MiB chunk is sent whole from inside it, so for most
	// archives this is the only place a refused upload shows.
	if err := w.Close(); err != nil {
		return fmt.Errorf("failed to upload %s: %w", destPath, err)
	}
	log.Printf("Finished after %v creating %s", time.Since(timeNow), destPath)
	return nil
}

// writeArchive streams the archive into w and finishes the tar and zstd
// streams, but leaves closing w, which publishes it, to the caller. It returns
// only once every download worker has exited.
//
// Workers only open the objects, up to DownloadWorkers ahead of the writer,
// so the GETs overlap; each body is copied straight into the tar, and no
// object is held in memory whole.
func (d *Dumper) writeArchive(ctx context.Context, w io.Writer, destPath string, files []FileInfo, indexContent string) ([]manifestRow, error) {
	timeNow := time.Now().UTC()
	zw, err := newArchiveWriter(w, d.cfg.ZstdWindowMB)
	if err != nil {
		return nil, fmt.Errorf("failed to start the zstd stream: %w", err)
	}
	// Counts the uncompressed tar stream, for where each body starts.
	tarBytes := &countingWriter{w: zw}
	tw := tar.NewWriter(tarBytes)
	rows := make([]manifestRow, 0, len(files))

	// Write index file
	indexBytes := []byte(indexContent)
	indexHeader := &tar.Header{
		Name:    "index.txt",
		Size:    int64(len(indexBytes)),
		Mode:    0644,
		ModTime: time.Now(),
	}
	if err := tw.WriteHeader(indexHeader); err != nil {
		return nil, fmt.Errorf("failed to write index header: %w", err)
	}
	if _, err := tw.Write(indexBytes); err != nil {
		return nil, fmt.Errorf("failed to write index content: %w", err)
	}

	workers := d.cfg.DownloadWorkers
	if workers <= 0 {
		workers = 10
	}

	totalFiles := len(files)
	var downloadedCount atomic.Int32
	var appendedCount atomic.Int32

	reportCtx, cancelReport := context.WithCancel(ctx)
	defer cancelReport()

	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-reportCtx.Done():
				return
			case <-ticker.C:
				dCount := downloadedCount.Load()
				aCount := appendedCount.Load()
				elapsed := time.Since(timeNow).Round(time.Second)
				log.Printf("[%s] running for %s: %d/%d opened, %d/%d appended", destPath, elapsed, dCount, totalFiles, aCount, totalFiles)
			}
		}
	}()

	// errgroup cancels gCtx only when a worker fails. A failed append has to
	// stop the workers too, or those waiting to hand over a file nobody will
	// read any more block forever.
	downloadCtx, stopDownloads := context.WithCancel(ctx)
	defer stopDownloads()
	g, gCtx := errgroup.WithContext(downloadCtx)

	jobs := make(chan FileInfo, len(files))
	for _, f := range files {
		jobs <- f
	}
	close(jobs)

	results := make(chan openedFile, workers)

	for i := 0; i < workers; i++ {
		g.Go(func() error {
			for file := range jobs {
				if err := gCtx.Err(); err != nil {
					return err
				}
				body, err := d.client.ReadObject(gCtx, file.Name)
				if err != nil {
					return fmt.Errorf("failed to read %s: %w", file.Name, err)
				}
				downloadedCount.Add(1)

				select {
				case results <- openedFile{file: file, body: body}:
				case <-gCtx.Done():
					body.Close()
					return gCtx.Err()
				}
			}
			return nil
		})
	}

	go func() {
		g.Wait()
		close(results)
	}()

	// closeRest closes what the workers opened and nobody will read.
	closeRest := func() {
		stopDownloads()
		for res := range results {
			res.body.Close()
		}
		g.Wait()
	}
	buf := make([]byte, 64<<10)
	for res := range results {
		sum, err := appendToTar(tw, res.file, res.body, buf)
		res.body.Close()
		if err != nil {
			closeRest()
			return nil, err
		}
		rows = append(rows, manifestRow{
			Name:      res.file.Name,
			URL:       urlOf(res.file.Hostname, res.file.Name),
			Host:      res.file.Hostname,
			Day:       res.file.Date,
			FetchedAt: res.file.Updated.UTC(),
			SHA256:    sum,
			Bytes:     res.file.Size,
			Archive:   destPath,
			Offset:    tarBytes.n - res.file.Size,
		})
		appendedCount.Add(1)
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}

	if err := tw.Close(); err != nil {
		return nil, fmt.Errorf("failed to finish the tar stream: %w", err)
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("failed to finish the zstd stream: %w", err)
	}
	// Only a finished encoder is kept; one abandoned mid-stream is dropped.
	releaseArchiveWriter(zw, d.cfg.ZstdWindowMB)
	return rows, nil
}

func getTarHeaderName(hostname, filename string) string {
	hostnamePrefix := fmt.Sprintf("hostname=%s/", hostname)
	idx := strings.Index(filename, hostnamePrefix)

	var relPath string
	if idx != -1 {
		relPath = filename[idx+len(hostnamePrefix):]
	} else {
		parts := strings.Split(filename, "/")
		relPath = parts[len(parts)-1]
	}

	return fmt.Sprintf("%s/%s", hostname, relPath)
}

// appendToTar copies one object into the archive under the size its listing
// gave, which the tar header needs before the body. A crawl object is written
// once and never changes, so a body of another length is an error, not
// something to archive.
func appendToTar(tw *tar.Writer, file FileInfo, body io.Reader, buf []byte) (string, error) {
	header := &tar.Header{
		Name:    getTarHeaderName(file.Hostname, file.Name),
		Size:    file.Size,
		Mode:    0644,
		ModTime: time.Now(),
	}
	if err := tw.WriteHeader(header); err != nil {
		return "", fmt.Errorf("failed to write header for %s: %w", file.Name, err)
	}
	hash := sha256.New()
	n, err := io.CopyBuffer(io.MultiWriter(tw, hash), io.LimitReader(body, file.Size), buf)
	if err == nil && n < file.Size {
		err = io.EOF
	}
	if err != nil {
		if errors.Is(err, io.EOF) {
			return "", fmt.Errorf("%s is %d bytes, its listing said %d", file.Name, n, file.Size)
		}
		return "", fmt.Errorf("failed to write content for %s: %w", file.Name, err)
	}
	var extra [1]byte
	if m, _ := body.Read(extra[:]); m > 0 {
		return "", fmt.Errorf("%s is longer than the %d bytes its listing said", file.Name, file.Size)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

type countingWriter struct {
	w io.Writer
	n int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	return n, err
}

// maxGlobDays is how many days back a night lists by date rather than the
// whole host; a chain that old is listed whole, as before there were dates.
const maxGlobDays = 62

// daysAfter is every day after from up to and including to, as YYYY-MM-DD.
func daysAfter(from, to string) []string {
	start, err1 := time.Parse("2006-01-02", from)
	end, err2 := time.Parse("2006-01-02", to)
	if err1 != nil || err2 != nil {
		return nil
	}
	var days []string
	for d := start.AddDate(0, 0, 1); !d.After(end); d = d.AddDate(0, 0, 1) {
		days = append(days, d.Format("2006-01-02"))
		if len(days) > maxGlobDays {
			break
		}
	}
	return days
}

// listDays lists only the objects of prefix stamped with one of days, where
// a listing of the whole prefix would page through the host's history every
// night. The caller filters by date as it does a whole listing, so the two
// give the same files.
func (d *Dumper) listDays(ctx context.Context, prefix string, days []string) ([]*storage.ObjectAttrs, error) {
	if len(days) == 0 {
		return nil, nil
	}
	started := time.Now()
	glob := prefix + "**date={" + strings.Join(days, ",") + "}**"
	objects, err := d.client.ListObjectsGlob(ctx, prefix, glob)
	if err != nil {
		return nil, fmt.Errorf("failed to list %s by %s: %w", prefix, glob, err)
	}
	log.Printf("Listed %d objects under %s for %d days in %v", len(objects), prefix, len(days), time.Since(started).Round(time.Second))
	return objects, nil
}
