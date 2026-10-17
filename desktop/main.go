//go:build desktop || bindings

package main

import (
	"embed"
	"io/fs"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:assets
var assets embed.FS

func main() {
	frontend, err := fs.Sub(assets, "assets")
	if err != nil {
		log.Fatal(err)
	}
	app := &App{}
	err = wails.Run(&options.App{
		Title: "NHAX session diff", Width: 1280, Height: 900,
		MinWidth: 800, MinHeight: 600,
		AssetServer: &assetserver.Options{Assets: frontend},
		OnStartup:   app.startup, Bind: []interface{}{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
