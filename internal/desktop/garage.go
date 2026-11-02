package desktop

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/freebeamer/core/pkg/types"
)

// Garage owns the saved application connection. Credentials stay in the Go
// process and a private config file, never in browser storage or response DTOs.
type Garage struct {
	mu   sync.Mutex
	live *LiveData
	path string
}

type garageConfig struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

func NewGarage(live *LiveData) *Garage { return &Garage{live: live} }

func (g *Garage) configPath() (string, error) {
	if g.path != "" {
		return g.path, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "freebeamer", "garage.json"), nil
}

// Restore is called after the app has subscribed to live events at startup.
func (g *Garage) Restore() (types.GarageSettings, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	path, err := g.configPath()
	if err != nil {
		return types.GarageSettings{}, errors.New("garage settings unavailable")
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return types.GarageSettings{}, nil
	}
	var config garageConfig
	if err != nil || json.Unmarshal(data, &config) != nil || config.Token == "" {
		return types.GarageSettings{}, errors.New("could not read garage settings")
	}
	if err := g.live.Connect(config.URL, config.Token, ""); err != nil {
		return types.GarageSettings{}, errors.New("invalid garage settings")
	}
	return types.GarageSettings{URL: config.URL, Configured: true}, nil
}

func (g *Garage) Configure(url, token string) (types.GarageSettings, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	url = strings.TrimSpace(url)
	base, err := relayBaseURL(url)
	if err != nil || base.User != nil || base.RawQuery != "" || base.Fragment != "" || strings.TrimSpace(token) == "" {
		return types.GarageSettings{}, errors.New("enter a garage API URL and token")
	}
	path, err := g.configPath()
	if err != nil {
		return types.GarageSettings{}, errors.New("garage settings unavailable")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return types.GarageSettings{}, errors.New("could not save garage settings")
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".garage-*")
	if err != nil {
		return types.GarageSettings{}, errors.New("could not save garage settings")
	}
	defer os.Remove(file.Name())
	data, _ := json.Marshal(garageConfig{URL: url, Token: token})
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return types.GarageSettings{}, errors.New("could not save garage settings")
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return types.GarageSettings{}, errors.New("could not save garage settings")
	}
	if err := g.live.Connect(url, token, ""); err != nil {
		return types.GarageSettings{}, errors.New("could not connect to garage")
	}
	return types.GarageSettings{URL: url, Configured: true}, nil
}
