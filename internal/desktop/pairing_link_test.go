package desktop

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/freebeamer/relay/relay"
)

// newFakeRelayServerWithAdmin is newFakeRelayServer without the
// pre-paired client — this test cares only about the admin-facing
// pairing-link endpoint, not an already-onboarded device.
func newFakeRelayServerWithAdmin(t *testing.T) (relayURL string) {
	t.Helper()
	store, err := relay.NewSQLiteStore(t.TempDir() + "/relay.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	server, err := relay.NewServer("127.0.0.1:0", relay.Config{Store: store, AdminToken: fakeRelayAdminToken})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)
	return httpServer.URL
}

func TestLiveDataCreatePairingLink(t *testing.T) {
	relayURL := newFakeRelayServerWithAdmin(t)
	l := NewLiveData()

	link, err := l.CreatePairingLink(context.Background(), relayURL, fakeRelayAdminToken, "Bay 3 - N55")
	if err != nil {
		t.Fatal(err)
	}
	if link.PairingToken == "" {
		t.Fatal("PairingToken is empty")
	}
	if link.DisplayName != "Bay 3 - N55" {
		t.Fatalf("DisplayName = %q", link.DisplayName)
	}
	if link.DeepLink == "" {
		t.Fatal("DeepLink is empty even though relayURL was passed as PublicURL")
	}
}

func TestLiveDataCreatePairingLinkRejectsBadAdminToken(t *testing.T) {
	relayURL := newFakeRelayServerWithAdmin(t)
	l := NewLiveData()

	if _, err := l.CreatePairingLink(context.Background(), relayURL, "wrong-token", "Bay 3"); err != errInvalidAdminToken {
		t.Fatalf("err = %v, want errInvalidAdminToken", err)
	}
}
