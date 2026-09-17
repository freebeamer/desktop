package desktop

import "github.com/freebeamer/core/pkg/types"

const maxRecentEntries = 8

// rememberRecent moves entry to the front of the list, de-duplicating by
// XDF/BIN pair and trimming to maxRecentEntries. It is a pure function so
// the ordering and de-duplication rules can be tested without a Service.
func rememberRecent(entries []types.RecentEntry, entry types.RecentEntry) []types.RecentEntry {
	next := make([]types.RecentEntry, 0, len(entries)+1)
	next = append(next, entry)
	for _, existing := range entries {
		if existing == entry {
			continue
		}
		next = append(next, existing)
	}
	if len(next) > maxRecentEntries {
		next = next[:maxRecentEntries]
	}
	return next
}
