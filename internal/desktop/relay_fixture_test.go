package desktop

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/freebeamer/relay/relay"
)

const fakeRelayAdminToken = "test-admin-token"

// newFakeRelayServer builds a real internal/relay.Server (real SQLite
// store, real dedup/backfill/catalog logic — not a hand-rolled mock) with
// one pre-registered client, wrapped in an httptest.Server LiveData can
// connect to directly. Mirrors cmd/freebeamer/relay_fixture_test.go's
// newFakeRelayServer (same same-module-import approach, motivated by the
// exported relay.Server.Handler() added during Phase 3a for exactly this).
func newFakeRelayServer(t *testing.T) (httpServer *httptest.Server, apiKey string) {
	t.Helper()
	store, err := relay.NewSQLiteStore(filepath.Join(t.TempDir(), "relay.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	const rawKey = "test-raw-api-key"
	sum := sha256.Sum256([]byte(rawKey))
	if _, err := store.CreateClient(context.Background(), "client-1", "Test Client", hex.EncodeToString(sum[:])); err != nil {
		t.Fatal(err)
	}

	server, err := relay.NewServer("127.0.0.1:0", relay.Config{Store: store, AdminToken: fakeRelayAdminToken})
	if err != nil {
		t.Fatal(err)
	}
	httpServer = httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)
	return httpServer, rawKey
}

// failNUpgradesHandler wraps h, refusing the first n WebSocket upgrade
// attempts (any request whose path is exactly "/v1/live") with a 503
// before forwarding the (n+1)th and all subsequent requests to h — fault
// injection for the reconnect/backoff test. Every other path is always
// forwarded unchanged.
func failNUpgradesHandler(h http.Handler, n int) http.Handler {
	attempts := 0
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/live" {
			attempts++
			if attempts <= n {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}
