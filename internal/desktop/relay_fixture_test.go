package desktop

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/freebeamer/relay/relay"
)

const fakeRelayAdminToken = "test-admin-token"

// hashFakeToken mirrors internal/relay/auth.go's unexported hashToken
// (SHA-256, hex-encoded) — this package can't import it directly since
// it's a different module, so the fixture reproduces the same
// convention to talk to the real Store directly, same as the relay
// module's own tests do.
func hashFakeToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// newFakeRelayServer builds a real internal/relay.Server (real SQLite
// store, real dedup/backfill/catalog logic — not a hand-rolled mock),
// pairs one client ("client-1") via the same pairing-link + Ed25519
// flow a real device would go through, and mints it a device session
// token directly against the store (skipping the HTTP challenge/
// response round trip, which relay's own tests already cover).
// Wrapped in an httptest.Server LiveData can connect to directly.
// Mirrors cmd/freebeamer/relay_fixture_test.go's newFakeRelayServer
// (same same-module-import approach, motivated by the exported
// relay.Server.Handler() added during Phase 3a for exactly this).
func newFakeRelayServer(t *testing.T) (httpServer *httptest.Server, deviceSessionToken string) {
	t.Helper()
	store, err := relay.NewSQLiteStore(filepath.Join(t.TempDir(), "relay.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	ctx := context.Background()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	const pairingToken = "test-pairing-token"
	if _, err := store.CreatePairingLink(ctx, hashFakeToken(pairingToken), "Test Client", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ConsumePairingLink(ctx, hashFakeToken(pairingToken), "client-1", pub); err != nil {
		t.Fatal(err)
	}

	const sessionToken = "test-device-session-token"
	if _, err := store.CreateDeviceSession(ctx, hashFakeToken(sessionToken), "client-1", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	server, err := relay.NewServer("127.0.0.1:0", relay.Config{Store: store, AdminToken: fakeRelayAdminToken})
	if err != nil {
		t.Fatal(err)
	}
	httpServer = httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)
	return httpServer, sessionToken
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
