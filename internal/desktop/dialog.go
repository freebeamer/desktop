package desktop

import "context"

// FileDialog is the native file dialog port the workspace and save services
// depend on. Production wiring uses WailsFileDialog; tests use a fake so
// workspace logic is verifiable without a running Wails frontend.
type FileDialog interface {
	OpenXDF(ctx context.Context) (string, error)
	OpenBIN(ctx context.Context) (string, error)
	// SaveBIN prompts for a destination path, pre-filled with defaultName.
	SaveBIN(ctx context.Context, defaultName string) (string, error)
}
