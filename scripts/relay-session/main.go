// Command relay-session mints a device session token directly against a
// relay SQLite store, for the local smoke harness. It mirrors the pairing
// (pairing-link -> consume -> device session) the CLI integration tests do
// in-process, skipping the HTTP challenge/response round trip the relay's
// own tests already cover. Development/test helper only, not production.
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"time"

	"github.com/freebeamer/relay/relay"
)

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func main() {
	db := flag.String("db", "", "relay SQLite path (created if absent)")
	token := flag.String("token", "smoke-device-session-token", "raw device session token to mint")
	ttl := flag.Duration("ttl", 24*time.Hour, "session and pairing-link lifetime")
	flag.Parse()
	if *db == "" {
		log.Fatal("relay-session: --db is required")
	}

	store, err := relay.NewSQLiteStore(*db)
	if err != nil {
		log.Fatalf("relay-session: open store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	expires := time.Now().Add(*ttl)
	const pairingToken = "smoke-pairing-token"
	if _, err := store.CreatePairingLink(ctx, hashToken(pairingToken), "Smoke harness", expires); err != nil {
		log.Fatalf("relay-session: create pairing link: %v", err)
	}
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatalf("relay-session: keygen: %v", err)
	}
	if _, err := store.ConsumePairingLink(ctx, hashToken(pairingToken), "smoke-client", pub); err != nil {
		log.Fatalf("relay-session: consume pairing link: %v", err)
	}
	if _, err := store.CreateDeviceSession(ctx, hashToken(*token), "smoke-client", expires); err != nil {
		log.Fatalf("relay-session: create device session: %v", err)
	}
	// Print the raw token so the harness can pass it to the CLI's --api-key.
	fmt.Println(*token)
}
