package desktop

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// WailsFileDialog implements FileDialog using the native Wails runtime
// dialogs. It has no state of its own so callers may share one instance.
type WailsFileDialog struct{}

var _ FileDialog = WailsFileDialog{}

func (WailsFileDialog) OpenXDF(ctx context.Context) (string, error) {
	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "Open XDF definition",
		Filters: []runtime.FileFilter{
			{DisplayName: "XDF definitions (*.xdf)", Pattern: "*.xdf"},
		},
	})
}

func (WailsFileDialog) OpenBIN(ctx context.Context) (string, error) {
	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "Open firmware image",
		Filters: []runtime.FileFilter{
			{DisplayName: "Binary images (*.bin)", Pattern: "*.bin"},
		},
	})
}

func (WailsFileDialog) SaveBIN(ctx context.Context, defaultName string) (string, error) {
	return runtime.SaveFileDialog(ctx, runtime.SaveDialogOptions{
		Title:           "Save checksum-corrected firmware image",
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "Binary images (*.bin)", Pattern: "*.bin"},
		},
	})
}
