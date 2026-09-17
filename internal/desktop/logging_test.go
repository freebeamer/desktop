package desktop

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withRestoredLogger saves and restores the standard logger's global output
// destination and flags, since InitLogging mutates package-level state that
// would otherwise leak into unrelated tests running later in this package.
func withRestoredLogger(t *testing.T) {
	t.Helper()
	originalOutput := log.Writer()
	originalFlags := log.Flags()
	t.Cleanup(func() {
		log.SetOutput(originalOutput)
		log.SetFlags(originalFlags)
	})
}

func TestInitLoggingCreatesFileAndWritesLogs(t *testing.T) {
	withRestoredLogger(t)
	base := t.TempDir()
	file, err := InitLogging(base)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	log.Println("hello test log")

	data, err := os.ReadFile(filepath.Join(base, "FreeBeamer", logFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "hello test log") {
		t.Fatalf("log file = %q, want it to contain the logged line", data)
	}
}

func TestInitLoggingAppendsAcrossCalls(t *testing.T) {
	withRestoredLogger(t)
	base := t.TempDir()

	first, err := InitLogging(base)
	if err != nil {
		t.Fatal(err)
	}
	log.Println("first line")
	first.Close()

	second, err := InitLogging(base)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	log.Println("second line")

	data, err := os.ReadFile(filepath.Join(base, "FreeBeamer", logFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "first line") || !strings.Contains(string(data), "second line") {
		t.Fatalf("log file = %q, want both lines preserved", data)
	}
}

func TestLogPanicLogsAndRePanics(t *testing.T) {
	withRestoredLogger(t)
	base := t.TempDir()
	file, err := InitLogging(base)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	func() {
		defer func() {
			if r := recover(); r != "boom" {
				t.Fatalf("recovered = %v, want %q", r, "boom")
			}
		}()
		defer LogPanic()
		panic("boom")
	}()

	data, err := os.ReadFile(filepath.Join(base, "FreeBeamer", logFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "panic: boom") {
		t.Fatalf("log file = %q, want it to record the panic", data)
	}
}
