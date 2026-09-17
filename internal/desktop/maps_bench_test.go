package desktop

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/freebeamer/core/pkg/types"
)

// openPrivateBenchService skips the benchmark, rather than failing it, when
// the private fixture isn't installed locally.
func openPrivateBenchService(b *testing.B) *Service {
	b.Helper()
	private := filepath.Join("..", "..", "testdata", "private")
	xdfPath := filepath.Join(private, "00000FEF81A001.xdf")
	binPath := filepath.Join(private, "00000FEF81A001_original.bin")
	for _, path := range []string{xdfPath, binPath} {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			b.Skip("private BMW fixtures are not installed")
		} else if err != nil {
			b.Fatal(err)
		}
	}
	service := NewService()
	if _, err := service.OpenWorkspace(xdfPath, binPath); err != nil {
		b.Fatal(err)
	}
	return service
}

// BenchmarkListMapsAllFixtureMaps profiles the initial map-list load: 962
// maps, unfiltered.
func BenchmarkListMapsAllFixtureMaps(b *testing.B) {
	service := openPrivateBenchService(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := service.ListMaps(types.MapFilter{}); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkListMapsSearch profiles a substring search over all 962 maps.
func BenchmarkListMapsSearch(b *testing.B) {
	service := openPrivateBenchService(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := service.ListMaps(types.MapFilter{Query: "timing"}); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkGetMapLargestFixtureMap profiles decoding the largest addressed
// map in the fixture (a 20x20 = 400-cell "Timing" table), representative of
// the largest single render the matrix editor will need to handle.
func BenchmarkGetMapLargestFixtureMap(b *testing.B) {
	service := openPrivateBenchService(b)
	page, err := service.ListMaps(types.MapFilter{Query: "Timing (Cold) (Map 3)"})
	if err != nil || len(page.Maps) == 0 {
		b.Fatalf("could not locate the representative large map: page=%#v err=%v", page, err)
	}
	id := page.Maps[0].ID
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := service.GetMap(id); err != nil {
			b.Fatal(err)
		}
	}
}
