package main

import (
	"embed"
	"log"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/freebeamer/desktop/internal/desktop"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	baseDir, err := os.UserConfigDir()
	if err != nil {
		baseDir = os.TempDir()
	}
	if logFile, err := desktop.InitLogging(baseDir); err != nil {
		log.Println("warning: could not initialize file logging:", err)
	} else {
		defer logFile.Close()
	}
	defer desktop.LogPanic()

	app := NewApp()
	if err := wails.Run(&options.App{
		Title:            "FreeBeamer",
		Width:            1440,
		Height:           900,
		MinWidth:         1024,
		MinHeight:        680,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: &options.RGBA{R: 15, G: 18, B: 22, A: 1},
		OnStartup:        app.startup,
		Bind:             []interface{}{app},
	}); err != nil {
		log.Fatal(err)
	}
}
