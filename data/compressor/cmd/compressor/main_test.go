package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The CPU profile is written on a run that fails too: os.Exit used to skip
// the deferred stop, and the file was left empty on every path.
func TestTheCPUProfileIsWrittenOnTheWayOut(t *testing.T) {
	profile := filepath.Join(t.TempDir(), "cpu.pprof")
	os.Args = []string{"compressor", "-cpuprofile", profile}
	t.Setenv("GCS_BUCKET", "")

	if code := run(); code != 1 {
		t.Fatalf("A run without a bucket exits %d, want 1", code)
	}

	info, err := os.Stat(profile)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() == 0 {
		t.Fatal("The CPU profile is empty")
	}
}
