package desktop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"github.com/freebeamer/core/pkg/relayapi"
	"github.com/freebeamer/core/pkg/telemetry"
	"github.com/freebeamer/core/pkg/types"
)

// relayRequestTimeout bounds every plain HTTP call to the relay
// (ListClients, GetCatalog) and the WebSocket handshake itself.
const relayRequestTimeout = 5 * time.Second

// errInvalidAdminToken is returned by dialLive/doAdminGET specifically for
// a 401 response, so callers can treat a bad admin token as terminal
// (never retried with backoff) rather than as a transient failure — see
// LiveData's reconnect loop.
var errInvalidAdminToken = errors.New("relay: invalid admin token")

// relayBaseURL parses and validates relayURL as an absolute http(s) URL,
// trimming any trailing slash so path joins below are unambiguous.
func relayBaseURL(relayURL string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSuffix(relayURL, "/"))
	if err != nil {
		return nil, fmt.Errorf("relay: invalid relay URL: %w", err)
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, errors.New("relay: relay URL must be an absolute http(s) URL")
	}
	return u, nil
}

func doAdminGET(ctx context.Context, relayURL, adminToken, path string, out any) error {
	base, err := relayBaseURL(relayURL)
	if err != nil {
		return err
	}
	base.Path += path
	ctx, cancel := context.WithTimeout(ctx, relayRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return errInvalidAdminToken
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("relay: unexpected status %d from %s", resp.StatusCode, path)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}

// listClients returns the relay's registered clients, for the desktop
// app's client picker.
func listClients(ctx context.Context, relayURL, adminToken string) ([]types.LiveClientSummary, error) {
	var summaries []relayapi.ClientSummary
	if err := doAdminGET(ctx, relayURL, adminToken, "/v1/clients", &summaries); err != nil {
		return nil, err
	}
	out := make([]types.LiveClientSummary, len(summaries))
	for i, s := range summaries {
		out[i] = types.LiveClientSummary{ID: s.ID, DisplayName: s.DisplayName, CreatedAt: s.CreatedAt}
	}
	return out, nil
}

// getCatalog returns the relay's current telemetry channel catalog —
// channel display labels/units, sourced from the relay rather than
// re-derived on the desktop side.
func getCatalog(ctx context.Context, relayURL, adminToken string) (types.LiveCatalog, error) {
	var catalog telemetry.Catalog
	if err := doAdminGET(ctx, relayURL, adminToken, "/v1/catalog", &catalog); err != nil {
		return types.LiveCatalog{}, err
	}
	channels := make([]types.LiveChannel, len(catalog.Channels))
	for i, c := range catalog.Channels {
		channels[i] = types.LiveChannel{ID: c.ID, Label: c.Label, Unit: c.Unit, SourceUnit: c.SourceUnit, Validation: c.Validation}
	}
	return types.LiveCatalog{ID: catalog.ID, Version: catalog.Version, Provenance: catalog.Provenance, Channels: channels}, nil
}

// dialLive opens the relay's GET /v1/live WebSocket feed for clientID.
// Mirrors internal/relay/server_test.go's TestLiveFeedBackfillThenLive
// handshake exactly: admin bearer token in the Authorization header,
// client_id as a query parameter.
func dialLive(ctx context.Context, relayURL, adminToken, clientID string) (*websocket.Conn, error) {
	base, err := relayBaseURL(relayURL)
	if err != nil {
		return nil, err
	}
	switch base.Scheme {
	case "http":
		base.Scheme = "ws"
	case "https":
		base.Scheme = "wss"
	}
	base.Path += "/v1/live"
	base.RawQuery = url.Values{"client_id": {clientID}}.Encode()

	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = relayRequestTimeout
	header := http.Header{"Authorization": []string{"Bearer " + adminToken}}
	conn, resp, err := dialer.DialContext(ctx, base.String(), header)
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusUnauthorized {
			return nil, errInvalidAdminToken
		}
		return nil, err
	}
	return conn, nil
}
