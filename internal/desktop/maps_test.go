package desktop

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/freebeamer/core/pkg/types"
)

func TestListMapsWithoutWorkspace(t *testing.T) {
	if _, err := NewService().ListMaps(types.MapFilter{}); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err = %v, want ErrNoWorkspace", err)
	}
}

func TestGetMapWithoutWorkspace(t *testing.T) {
	if _, err := NewService().GetMap(0); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("err = %v, want ErrNoWorkspace", err)
	}
}

func openBasicWorkspace(t *testing.T) *Service {
	t.Helper()
	service := NewService()
	if _, err := service.OpenWorkspace(basicXDF(), fittingBIN(t)); err != nil {
		t.Fatal(err)
	}
	return service
}

func TestListMapsReturnsDeclaredMaps(t *testing.T) {
	service := openBasicWorkspace(t)
	page, err := service.ListMaps(types.MapFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Maps) != 1 {
		t.Fatalf("page = %#v", page)
	}
	got := page.Maps[0]
	if got.ID != 0 || got.Title != "Boost target" {
		t.Fatalf("map summary = %#v", got)
	}
	if len(got.Categories) != 1 || got.Categories[0] != "Boost" {
		t.Fatalf("categories = %#v", got.Categories)
	}
	// basic.xdf's "Boost target" declares a 2x2 Z matrix (rowcount=2,
	// colcount=2), so shape follows Z's own dimensions regardless of X/Y.
	if got.Shape != types.ShapeMatrix {
		t.Fatalf("shape = %q, want %q", got.Shape, types.ShapeMatrix)
	}
	// basic.xdf declares two categories, but only "Boost" is referenced by
	// any table's CATEGORYMEM, so only "Boost" is surfaced for navigation.
	if len(page.Categories) != 1 || page.Categories[0] != "Boost" {
		t.Fatalf("page.Categories = %#v", page.Categories)
	}
}

func TestListMapsFiltersByQueryAndCategory(t *testing.T) {
	service := openBasicWorkspace(t)

	if page, err := service.ListMaps(types.MapFilter{Query: "boost"}); err != nil || page.Total != 1 {
		t.Fatalf("query match: page=%#v err=%v", page, err)
	}
	if page, err := service.ListMaps(types.MapFilter{Query: "nonexistent"}); err != nil || page.Total != 0 {
		t.Fatalf("query miss: page=%#v err=%v", page, err)
	}
	if page, err := service.ListMaps(types.MapFilter{Category: "Boost"}); err != nil || page.Total != 1 {
		t.Fatalf("category match: page=%#v err=%v", page, err)
	}
	if page, err := service.ListMaps(types.MapFilter{Category: "Fuel"}); err != nil || page.Total != 0 {
		t.Fatalf("category miss: page=%#v err=%v", page, err)
	}
}

func TestGetMapDecodesFullDetailWithAddresses(t *testing.T) {
	service := openBasicWorkspace(t)
	detail, err := service.GetMap(0)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Title != "Boost target" || detail.Shape != types.ShapeMatrix {
		t.Fatalf("detail = %#v", detail)
	}
	if detail.Rows != 2 || detail.Columns != 2 {
		t.Fatalf("dimensions = %dx%d", detail.Rows, detail.Columns)
	}
	if got := detail.ZValues; len(got) != 2 || got[0][0] != 1 || got[0][1] != 2 || got[1][0] != 3 || got[1][1] != 4 {
		t.Fatalf("ZValues = %#v", got)
	}
	if got := detail.ZAddresses; got[0][0] != "0x200" || got[0][1] != "0x202" || got[1][0] != "0x204" || got[1][1] != "0x206" {
		t.Fatalf("ZAddresses = %#v", got)
	}
	if len(detail.XValues) != 2 || detail.XValues[0] != 1000 || detail.XValues[1] != 2000 {
		t.Fatalf("XValues = %#v", detail.XValues)
	}
	if got := detail.XAddresses; len(got) != 2 || got[0] != "0x100" || got[1] != "0x102" {
		t.Fatalf("XAddresses = %#v", got)
	}
	if detail.X.Units != "rpm" || detail.X.Formula != "X*10" || !detail.X.Addressed {
		t.Fatalf("X axis detail = %#v", detail.X)
	}
	if detail.Diagnostics != "" {
		t.Fatalf("diagnostics = %q, want empty for a valid map", detail.Diagnostics)
	}
}

func TestGetMapRejectsUnknownID(t *testing.T) {
	service := openBasicWorkspace(t)
	if _, err := service.GetMap(99); err == nil {
		t.Fatal("expected an error for an out-of-range map id")
	}
}

func TestGetMapReportsInvalidShapeInsteadOfErroring(t *testing.T) {
	service := NewService()
	// basic.xdf reads "Boost target" from 0x100-0x208; 4 bytes cannot
	// satisfy that, so decoding must fail without the call itself erroring.
	tooSmall := filepath.Join(t.TempDir(), "too-small.bin")
	if err := os.WriteFile(tooSmall, make([]byte, 4), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.OpenWorkspace(basicXDF(), tooSmall); err != nil {
		t.Fatal(err)
	}
	detail, err := service.GetMap(0)
	if err != nil {
		t.Fatalf("GetMap should report invalid shape rather than error, got err=%v", err)
	}
	if detail.Shape != types.ShapeInvalid || detail.Diagnostics == "" {
		t.Fatalf("detail = %#v, want types.ShapeInvalid with a diagnostic", detail)
	}
}

func TestPrivateMapsListMatchesInspectCounts(t *testing.T) {
	private := filepath.Join("..", "..", "testdata", "private")
	xdfPath := filepath.Join(private, "00000FEF81A001.xdf")
	binPath := filepath.Join(private, "00000FEF81A001_original.bin")
	for _, path := range []string{xdfPath, binPath} {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			t.Skip("private BMW fixtures are not installed")
		} else if err != nil {
			t.Fatal(err)
		}
	}

	service := NewService()
	if _, err := service.OpenWorkspace(xdfPath, binPath); err != nil {
		t.Fatal(err)
	}
	page, err := service.ListMaps(types.MapFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 962 || len(page.Maps) != 962 {
		t.Fatalf("page.Total = %d, len(Maps) = %d, want 962", page.Total, len(page.Maps))
	}
	byTitle := make(map[string]types.MapSummary, len(page.Maps))
	for _, summary := range page.Maps {
		if _, dup := byTitle[summary.Title]; !dup {
			byTitle[summary.Title] = summary
		}
	}

	scalar, ok := byTitle["Zeitkonstante zum Abschalten des Massenstromregler Hub"]
	if !ok || scalar.Shape != types.ShapeScalar {
		t.Fatalf("scalar map = %#v, ok=%v", scalar, ok)
	}
	oneAxis, ok := byTitle["Performance gauge scaling X (autogen)"]
	if !ok || oneAxis.Shape != types.ShapeOneAxis {
		t.Fatalf("one-axis map = %#v, ok=%v", oneAxis, ok)
	}
	matrix, ok := byTitle["Performance gauge scaling"]
	if !ok || matrix.Shape != types.ShapeMatrix {
		t.Fatalf("matrix map = %#v, ok=%v", matrix, ok)
	}

	detail, err := service.GetMap(matrix.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Shape != types.ShapeMatrix || detail.Rows != 6 || detail.Columns != 6 {
		t.Fatalf("matrix detail = %#v", detail)
	}
	if detail.Diagnostics != "" {
		t.Fatalf("diagnostics = %q, want empty for the validated fixture", detail.Diagnostics)
	}
}
