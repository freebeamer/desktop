package desktop

import (
	"fmt"
	"sort"
	"strings"

	"github.com/freebeamer/core/pkg/types"
)

// ListMaps returns every map in the open workspace whose title matches
// filter.Query (case-insensitively) and, if set, filter.Category. It does
// not decode maps; shape classification only inspects canonical dimensions.
func (s *Service) ListMaps(filter types.MapFilter) (types.MapPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workspace == nil {
		return types.MapPage{}, ErrNoWorkspace
	}
	def := s.workspace.definition
	query := strings.ToLower(strings.TrimSpace(filter.Query))
	category := strings.TrimSpace(filter.Category)

	categorySet := map[string]struct{}{}
	summaries := make([]types.MapSummary, 0, len(def.Parameters))
	for index, parameter := range def.Parameters {
		if parameter.Kind == "flag" {
			continue
		}
		names := def.CategoryNames(parameter.Categories)
		for _, name := range names {
			categorySet[name] = struct{}{}
		}
		if query != "" && !strings.Contains(strings.ToLower(parameter.Name), query) {
			continue
		}
		if category != "" && !containsString(names, category) {
			continue
		}
		summaries = append(summaries, types.MapSummary{
			ID:         index,
			Title:      parameter.Name,
			Categories: names,
			Shape:      declaredShape(parameter),
		})
	}

	categories := make([]string, 0, len(categorySet))
	for name := range categorySet {
		categories = append(categories, name)
	}
	sort.Strings(categories)

	return types.MapPage{
		Generation: s.workspace.generation,
		Total:      len(summaries),
		Categories: categories,
		Maps:       summaries,
	}, nil
}

// GetMap decodes exactly one map and returns its full detail, including a
// per-cell address for every raw/decoded value pair.
func (s *Service) GetMap(mapID int) (types.MapDetail, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.workspace == nil {
		return types.MapDetail{}, ErrNoWorkspace
	}
	def := s.workspace.definition
	if mapID < 0 || mapID >= len(def.Parameters) {
		return types.MapDetail{}, fmt.Errorf("desktop: no map with id %d", mapID)
	}
	parameter := def.Parameters[mapID]
	if parameter.Kind == "flag" {
		return types.MapDetail{}, fmt.Errorf("desktop: no map with id %d", mapID)
	}

	detail := types.MapDetail{
		ID:          mapID,
		ParameterID: parameter.ID,
		Title:       parameter.Name,
		Description: parameter.Description,
		Categories:  def.CategoryNames(parameter.Categories),
		X:           axisDetail(parameter.Axes["x"]),
		Y:           axisDetail(parameter.Axes["y"]),
		Z:           parameterDetail(parameter),
	}

	decoded, err := s.workspace.decoder.DecodeParameter(parameter)
	if err != nil {
		detail.Shape = types.ShapeInvalid
		detail.Diagnostics = err.Error()
		return detail, nil
	}

	detail.Shape = classifyShape(decoded)
	detail.Rows = len(decoded.Z)
	if detail.Rows > 0 {
		detail.Columns = len(decoded.Z[0])
	}
	detail.XValues, detail.XRaw, detail.XAddresses = decoded.X, decoded.Raw.X, hexAddresses(decoded.Addresses.X)
	detail.YValues, detail.YRaw, detail.YAddresses = decoded.Y, decoded.Raw.Y, hexAddresses(decoded.Addresses.Y)
	detail.ZValues, detail.ZRaw, detail.ZAddresses = decoded.Z, decoded.Raw.Z, hexAddressRows(decoded.Addresses.Z)

	return detail, nil
}
