// Package desktop is the Wails-facing boundary between the Angular frontend
// and the proven FreeBeamer V0 engine (pkg/xdf, pkg/binfile, pkg/calibration,
// pkg/identify, pkg/checksum). It owns the one active workspace, native
// dialogs, and DTO mapping; it must never re-implement identification or
// checksum logic that already lives in those packages.
package desktop

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/freebeamer/core/pkg/binfile"
	"github.com/freebeamer/core/pkg/calibration"
	"github.com/freebeamer/core/pkg/checksum"
	"github.com/freebeamer/core/pkg/checksum/bmw/mevd1726"
	"github.com/freebeamer/core/pkg/identify"
	"github.com/freebeamer/core/pkg/types"
	"github.com/freebeamer/core/pkg/vehicleprofile"
	"github.com/freebeamer/core/pkg/xdf"
)

const APIVersion = "desktop-v1"

var (
	// ErrNoWorkspace is returned by GetWorkspace when nothing has been opened yet.
	ErrNoWorkspace = errors.New("desktop: no workspace is open")
	// ErrDialogCancelled is returned when the user closes a native file
	// dialog without choosing a file. Callers should treat it as a no-op,
	// not a failure.
	ErrDialogCancelled = errors.New("desktop: file selection was cancelled")
)

type Service struct {
	mu          sync.Mutex
	checksums   *checksum.Registry
	workspace   *workspace
	generation  uint64
	recents     []types.RecentEntry
	profilePath string
	association *profileAssociation
}

func NewService() *Service {
	registry, err := checksum.NewRegistry(mevd1726.New())
	if err != nil {
		// The provider set is static and known-valid; this cannot fail.
		panic(fmt.Errorf("desktop: build checksum registry: %w", err))
	}
	return &Service{checksums: registry}
}

func (*Service) Health() types.HealthStatus {
	return types.HealthStatus{Ready: true, APIVersion: APIVersion, Engine: "FreeBeamer Go"}
}

// OpenWorkspace loads an XDF/BIN pair directly by path.
func (s *Service) OpenWorkspace(xdfPath, binPath string) (types.WorkspaceSummary, error) {
	xdfPath = strings.TrimSpace(xdfPath)
	binPath = strings.TrimSpace(binPath)
	if xdfPath == "" || binPath == "" {
		return types.WorkspaceSummary{}, errors.New("desktop: an XDF path and a BIN path are required")
	}

	definition, err := xdf.ImportMapDefinition(xdfPath)
	if err != nil {
		return types.WorkspaceSummary{}, fmt.Errorf("import XDF: %w", err)
	}
	image, err := binfile.Load(binPath)
	if err != nil {
		return types.WorkspaceSummary{}, fmt.Errorf("load BIN: %w", err)
	}
	decoder, err := calibration.New(definition, image)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}

	definitionHash, err := vehicleprofile.DefinitionFingerprint(definition)
	if err != nil {
		return types.WorkspaceSummary{}, err
	}
	originalHash := sha256.Sum256(image.Original())
	s.mu.Lock()
	defer s.mu.Unlock()

	s.generation++
	ws := &workspace{
		generation:      s.generation,
		bindingIdentity: types.BindingWorkspace{DefinitionID: definition.ID, DefinitionSHA256: definitionHash, OriginalSHA256: hex.EncodeToString(originalHash[:]), OriginalSize: image.Size()},
		xdfPath:         xdfPath,
		binPath:         binPath,
		definition:      definition,
		image:           image,
		decoder:         decoder,
		identity:        identify.Identify(image.Bytes()),
		validation:      decoder.Validate(),
	}
	s.workspace = ws
	s.association = nil
	s.recents = rememberRecent(s.recents, types.RecentEntry{XDFPath: xdfPath, BinPath: binPath})

	return summarize(ws, s.checksums), nil
}

// ChooseAndOpenWorkspace prompts for an XDF then a matching BIN through
// dialog and opens the resulting pair. It returns ErrDialogCancelled if the
// user closes either dialog without choosing a file.
func (s *Service) ChooseAndOpenWorkspace(ctx context.Context, dialog FileDialog) (types.WorkspaceSummary, error) {
	if dialog == nil {
		return types.WorkspaceSummary{}, errors.New("desktop: no file dialog available")
	}
	xdfPath, err := dialog.OpenXDF(ctx)
	if err != nil {
		return types.WorkspaceSummary{}, fmt.Errorf("choose XDF: %w", err)
	}
	if xdfPath == "" {
		return types.WorkspaceSummary{}, ErrDialogCancelled
	}
	binPath, err := dialog.OpenBIN(ctx)
	if err != nil {
		return types.WorkspaceSummary{}, fmt.Errorf("choose BIN: %w", err)
	}
	if binPath == "" {
		return types.WorkspaceSummary{}, ErrDialogCancelled
	}
	return s.OpenWorkspace(xdfPath, binPath)
}

// GetWorkspace returns the summary of the currently open workspace, if any.
func (s *Service) GetWorkspace() (types.WorkspaceSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workspace == nil {
		return types.WorkspaceSummary{}, ErrNoWorkspace
	}
	return summarize(s.workspace, s.checksums), nil
}

// CloseWorkspace discards the active workspace, if any.
func (s *Service) CloseWorkspace() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.workspace = nil
	s.association = nil
}

// RecentWorkspaces lists previously opened XDF/BIN pairs, most recent first,
// for this run of the application.
func (s *Service) RecentWorkspaces() []types.RecentEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]types.RecentEntry(nil), s.recents...)
}
