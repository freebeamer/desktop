package desktop

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime/debug"
)

const logFileName = "freebeamer.log"

// InitLogging opens (creating if needed) a log file under baseDir/FreeBeamer
// and directs the standard logger to write to both it and stderr, so a
// crash or unexpected error leaves a durable trace for support instead of
// only ever appearing in a terminal the user didn't have open. Callers
// should defer the returned file's Close.
func InitLogging(baseDir string) (*os.File, error) {
	dir := filepath.Join(baseDir, "FreeBeamer")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("desktop: create log directory: %w", err)
	}
	path := filepath.Join(dir, logFileName)
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("desktop: open log file: %w", err)
	}
	log.SetOutput(io.MultiWriter(file, os.Stderr))
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	return file, nil
}

// LogPanic recovers a panic, logs it with a stack trace so it survives in
// the log file InitLogging set up, and re-panics so the process still
// terminates (or an outer recover still runs) — logging is a side effect
// here, never a silent substitute for crashing loudly.
func LogPanic() {
	if r := recover(); r != nil {
		log.Printf("panic: %v\n%s", r, debug.Stack())
		panic(r)
	}
}
