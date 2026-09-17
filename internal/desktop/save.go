package desktop

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/freebeamer/core/pkg/binfile"
	"github.com/freebeamer/core/pkg/checksum"
	"github.com/freebeamer/core/pkg/types"
)

// ErrUnsupportedFirmware is returned by SaveAs/ChooseAndSaveAs when no
// checksum provider matches the current image: V1 refuses to export a
// firmware image it cannot verify, per docs/desktop-v1-plan.md Phase 5.
var ErrUnsupportedFirmware = errors.New("desktop: no checksum provider supports this firmware; refusing to save")

// VerifyChecksums re-verifies the open workspace's current working image
// without saving anything, for a save-review screen to show before the
// user commits to Save As.
func (s *Service) VerifyChecksums() (types.ChecksumSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workspace == nil {
		return types.ChecksumSummary{}, ErrNoWorkspace
	}
	return summarizeChecksum(s.checksums, s.workspace.image.Bytes()), nil
}

// SaveAs verifies the current image, corrects a clone through the
// registered checksum provider, post-verifies every region, and only then
// writes the corrected bytes to a new file at path. It never touches the
// workspace's own working image or the original BIN.
func (s *Service) SaveAs(path string) (types.SaveOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveAsLocked(path)
}

// ChooseAndSaveAs prompts for a destination via dialog, pre-filled with a
// name derived from the original BIN, then behaves exactly like SaveAs.
func (s *Service) ChooseAndSaveAs(ctx context.Context, dialog FileDialog) (types.SaveOutcome, error) {
	if dialog == nil {
		return types.SaveOutcome{}, errors.New("desktop: no file dialog available")
	}
	s.mu.Lock()
	if s.workspace == nil {
		s.mu.Unlock()
		return types.SaveOutcome{}, ErrNoWorkspace
	}
	defaultName := suggestedSaveName(s.workspace.binPath)
	s.mu.Unlock()

	path, err := dialog.SaveBIN(ctx, defaultName)
	if err != nil {
		return types.SaveOutcome{}, fmt.Errorf("choose save path: %w", err)
	}
	if path == "" {
		return types.SaveOutcome{}, ErrDialogCancelled
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveAsLocked(path)
}

func (s *Service) saveAsLocked(path string) (types.SaveOutcome, error) {
	if s.workspace == nil {
		return types.SaveOutcome{}, ErrNoWorkspace
	}
	ws := s.workspace
	path = strings.TrimSpace(path)
	if path == "" {
		return types.SaveOutcome{}, errors.New("desktop: a save path is required")
	}

	working := ws.image.Bytes()
	before := summarizeChecksum(s.checksums, working)

	provider, corrected, results, err := s.checksums.CorrectAndVerify(working)
	if errors.Is(err, checksum.ErrProviderNotFound) {
		return types.SaveOutcome{}, ErrUnsupportedFirmware
	}
	if err != nil {
		return types.SaveOutcome{}, fmt.Errorf("desktop: checksum correction failed, refusing to save: %w", err)
	}
	if uint64(len(corrected)) != ws.image.Size() {
		return types.SaveOutcome{}, errors.New("desktop: checksum provider changed the image size, refusing to save")
	}

	if err := binfile.SaveBytes(path, corrected, ws.binPath); err != nil {
		return types.SaveOutcome{}, err
	}

	sum := sha256.Sum256(corrected)
	return types.SaveOutcome{
		Path:            path,
		SHA256:          hex.EncodeToString(sum[:]),
		Provider:        provider,
		RegionsVerified: len(results),
		WasAlreadyValid: before.Status == "valid",
	}, nil
}

func suggestedSaveName(binPath string) string {
	base := filepath.Base(binPath)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	if stem == "" {
		stem = "firmware"
	}
	if ext == "" {
		ext = ".bin"
	}
	return stem + "-corrected" + ext
}
