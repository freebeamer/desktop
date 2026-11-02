package desktop

import (
	"encoding/json"
	"github.com/freebeamer/core/pkg/telemetry"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGaragePersistsAndRestoresConnection(t *testing.T) {
	live := NewLiveData()
	defer live.Disconnect()
	garage := &Garage{live: live, path: filepath.Join(t.TempDir(), "config", "garage.json")}
	settings, err := garage.Restore()
	if err != nil || settings.Configured {
		t.Fatalf("initial restore: %+v %v", settings, err)
	}
	settings, err = garage.Configure("http://127.0.0.1:1", "private-token")
	if err != nil || !settings.Configured {
		t.Fatalf("configure: %+v %v", settings, err)
	}
	encoded, _ := json.Marshal(settings)
	if strings.Contains(string(encoded), "private-token") {
		t.Fatal("settings expose credentials")
	}
	info, err := os.Stat(garage.path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("permissions = %v", info.Mode())
	}
	live.Disconnect()
	restarted := &Garage{live: live, path: garage.path}
	settings, err = restarted.Restore()
	if err != nil || !settings.Configured {
		t.Fatalf("restore: %+v %v", settings, err)
	}
	live.mu.Lock()
	scope := live.scope
	live.mu.Unlock()
	if scope.relayURL != settings.URL || scope.adminToken != "private-token" || scope.clientID != "" {
		t.Fatal("garage scope was not restored")
	}
}

func TestGarageRejectsInvalidSettingsWithoutReplacingSavedConnection(t *testing.T) {
	live := NewLiveData()
	defer live.Disconnect()
	garage := &Garage{live: live, path: filepath.Join(t.TempDir(), "garage.json")}
	if _, err := garage.Configure("http://127.0.0.1:1", "token"); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(garage.path)
	for _, url := range []string{"invalid", "https://user:secret@garage.example", "https://garage.example?token=secret"} {
		if _, err := garage.Configure(url, "token"); err == nil {
			t.Fatalf("accepted %q", url)
		}
	}
	after, _ := os.ReadFile(garage.path)
	if string(before) != string(after) {
		t.Fatal("invalid configuration overwrote saved garage")
	}
}

func TestGarageDeviceSelectionFollowsNewSessions(t *testing.T) {
	server, apiKey := newFakeRelayServer(t)
	live, emitter := newLiveDataForTest()
	defer live.Disconnect()
	garage := &Garage{live: live, path: filepath.Join(t.TempDir(), "garage.json")}
	if _, err := garage.Configure(server.URL, fakeRelayAdminToken); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 2*time.Second, func() bool { return live.Status().State == "connected" })
	live.SetDeviceSession("phone", "")
	generation := live.Status().Generation
	for _, id := range []string{"session-1", "session-2"} {
		session, err := telemetry.NewSession()
		if err != nil {
			t.Fatal(err)
		}
		session.ID = id
		postSample(t, server.URL, apiKey, v2Sample("phone", session, 0, map[string]float64{"RPM": 800}))
		waitFor(t, 2*time.Second, func() bool {
			for _, sample := range emitter.AllSamples() {
				if sample.SessionID == id {
					return true
				}
			}
			return false
		})
	}
	if live.Status().State != "connected" || live.Status().Generation != generation {
		t.Fatal("device sessions should use the existing garage connection")
	}
}
