package desktop

import (
	"encoding/hex"
	"errors"

	"github.com/freebeamer/core/pkg/binfile"
	"github.com/freebeamer/core/pkg/calibration"
	"github.com/freebeamer/core/pkg/checksum"
	"github.com/freebeamer/core/pkg/types"
)

// workspace holds one canonical map definition and its binary image. Source
// formats are converted before the workspace is created.
type workspace struct {
	bindingIdentity types.BindingWorkspace
	generation      uint64
	xdfPath         string
	binPath         string
	definition      *types.MapDefinition
	image           *binfile.Image
	decoder         *calibration.Decoder
	identity        types.ECUIdentity
	validation      []error

	undo []editTransaction
	redo []editTransaction
}

func summarize(ws *workspace, registry *checksum.Registry) types.WorkspaceSummary {
	def := ws.definition
	regionFits := def.MemoryFits(ws.image.Size())
	mapCount := countParameters(def.Parameters, "flag", false)
	compatibility := types.DesktopCompatibility{
		RegionFitsROM:       regionFits,
		AddressedMaps:       mapCount - len(ws.validation),
		TotalMaps:           mapCount,
		MapValidationErrors: len(ws.validation),
	}

	checksumSummary := summarizeChecksum(registry, ws.image.Bytes())
	editingAllowed, refusalReason := evaluateEditingGate(regionFits, checksumSummary)

	sum := ws.image.SHA256()
	identity := ws.identity

	return types.WorkspaceSummary{
		Generation: ws.generation,
		XDFPath:    ws.xdfPath,
		BinPath:    ws.binPath,
		ROM: types.RomSummary{
			SizeBytes: int64(ws.image.Size()),
			SHA256:    hex.EncodeToString(sum[:]),
		},
		ECU: types.ECUSummary{
			Manufacturer: identity.Manufacturer,
			Vendor:       identity.ECUVendor,
			Family:       identity.ECUFamily,
			Engine:       identity.Engine,
			Confidence:   identity.Confidence.String(),
		},
		XDF: types.XDFSummary{
			Version:    def.Provenance.SourceVersion,
			Categories: len(def.Categories),
			Tables:     countParameters(def.Parameters, "flag", false),
			Flags:      countParameters(def.Parameters, "flag", true),
		},
		Compatibility:  compatibility,
		Checksum:       checksumSummary,
		EditingAllowed: editingAllowed,
		RefusalReason:  refusalReason,
		ChangedBytes:   len(ws.image.Diff()),
		EditCount:      len(ws.undo),
		CanUndo:        len(ws.undo) > 0,
		CanRedo:        len(ws.redo) > 0,
	}
}

func countParameters(parameters []types.MapParameter, kind string, equal bool) int {
	count := 0
	for _, parameter := range parameters {
		if (parameter.Kind == kind) == equal {
			count++
		}
	}
	return count
}

func summarizeChecksum(registry *checksum.Registry, image []byte) types.ChecksumSummary {
	provider, results, err := registry.Verify(image)
	if errors.Is(err, checksum.ErrProviderNotFound) {
		return types.ChecksumSummary{Status: "unsupported"}
	}
	if err != nil {
		return types.ChecksumSummary{Provider: provider, Status: "error", Message: err.Error()}
	}
	status := "invalid"
	if checksum.AllValid(results) {
		status = "valid"
	}
	return types.ChecksumSummary{Provider: provider, Status: status, Regions: len(results)}
}

// evaluateEditingGate refuses an editing session exactly where the V0 engine
// itself would reject the pairing: the XDF's declared region does not fit
// inside the loaded ROM, or checksum verification errored outright. A
// firmware with no matching checksum provider, or one whose stored checksum
// is already invalid, is still inspectable and editable in V1 — it simply
// has no automatic correction available at Save As time.
func evaluateEditingGate(regionFits bool, checksumSummary types.ChecksumSummary) (bool, string) {
	if !regionFits {
		return false, "the definition's declared memory does not fit inside this BIN"
	}
	if checksumSummary.Status == "error" {
		return false, "checksum verification failed: " + checksumSummary.Message
	}
	return true, ""
}
