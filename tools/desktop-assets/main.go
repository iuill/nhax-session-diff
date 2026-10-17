// desktop-assets copies the shared Web UI without the browser-only WASM engine.
// Run from desktop/ (also invoked by Wails).
package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	if err := os.MkdirAll("assets", 0755); err != nil {
		log.Fatal(err)
	}
	for _, name := range []string{"index.html", "style.css", "app.js", "differences.js", "engine.js", "journal.js"} {
		data, err := os.ReadFile(filepath.Join("..", "web", name))
		if err != nil {
			log.Fatal(err)
		}
		if name == "index.html" {
			s := string(data)
			// Wails injects its runtime and bindings. External navigation is disabled by the desktop adapter.
			s = strings.Replace(s, "script-src 'self' 'wasm-unsafe-eval'", "script-src 'self' 'unsafe-inline'", 1)
			s = strings.ReplaceAll(s, "ファイルはこのブラウザ内で解析", "ファイルはこのPC内で解析")
			s = strings.ReplaceAll(s, "ページを閉じると", "アプリを閉じると")
			s = strings.ReplaceAll(s, "NHAXファイルをドロップ", "NHAXファイルを選択")
			s = strings.ReplaceAll(s, "またはクリックして選択 · 複数ファイル可", "クリックして選択 · 複数ファイル可")
			data = []byte(s)
		}
		if err := os.WriteFile(filepath.Join("assets", name), data, 0644); err != nil {
			log.Fatal(err)
		}
	}
}
