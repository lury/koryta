package main

import (
	"context"
	"log"
	"os"
	"runtime"
	"runtime/pprof"

	"github.com/koryta/compressor/internal/config"
	"github.com/koryta/compressor/internal/gcs"
	"github.com/koryta/compressor/internal/processor"
)

// The exit code is decided in run, so that its defers - the CPU profile's
// stop above all, which os.Exit would skip - run on every path out.
func main() {
	os.Exit(run())
}

func run() int {
	cfg := config.Parse()

	if cfg.CpuProfile != "" {
		f, err := os.Create(cfg.CpuProfile)
		if err != nil {
			log.Print("could not create CPU profile: ", err)
			return 1
		}
		defer f.Close()
		if err := pprof.StartCPUProfile(f); err != nil {
			log.Print("could not start CPU profile: ", err)
			return 1
		}
		defer pprof.StopCPUProfile()
	}

	if cfg.BucketName == "" {
		log.Print("GCS bucket name is required. Set via -bucket flag or GCS_BUCKET environment variable.")
		return 1
	}

	ctx := context.Background()

	client, err := gcs.NewClient(ctx, cfg.BucketName)
	if err != nil {
		log.Printf("Failed to initialize GCS source client: %v", err)
		return 1
	}
	defer client.Close()

	outClient, err := gcs.NewClient(ctx, cfg.OutBucket)
	if err != nil {
		log.Printf("Failed to initialize GCS dest client: %v", err)
		return 1
	}
	defer outClient.Close()

	dumper := processor.NewDumper(client, outClient, cfg)

	if err := dumper.Run(ctx); err != nil {
		log.Printf("Dumper run failed: %v", err)
		return 1
	}

	log.Println("Compression job finished successfully.")

	if cfg.MemProfile != "" {
		f, err := os.Create(cfg.MemProfile)
		if err != nil {
			log.Print("could not create memory profile: ", err)
			return 1
		}
		defer f.Close()
		runtime.GC() // get up-to-date statistics
		if err := pprof.WriteHeapProfile(f); err != nil {
			log.Print("could not write memory profile: ", err)
			return 1
		}
	}
	return 0
}
