// desktop-notices collects upstream license and notice files alongside the GUI executable.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func main() {
	if len(os.Args) != 3 {
		log.Fatal("usage: desktop-notices MODULE_DIR OUTPUT")
	}
	var out bytes.Buffer
	out.WriteString("NHAX desktop — third-party licenses and notices\n\n")
	goLicense, err := os.ReadFile(filepath.Join(runtime.GOROOT(), "LICENSE"))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Fprintf(&out, "Go runtime\n%s\n", goLicense)
	cmd := exec.Command("go", "list", "-m", "-json", "all")
	cmd.Dir = os.Args[1]
	data, err := cmd.Output()
	if err != nil {
		log.Fatal(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	for {
		var module struct {
			Path, Version, Dir string
			Main               bool
			Replace            *struct{ Dir string }
		}
		if err := decoder.Decode(&module); err == io.EOF {
			break
		} else if err != nil {
			log.Fatal(err)
		}
		if module.Main || module.Path == "github.com/iuill/nhax-session-diff" {
			continue
		}
		if module.Replace != nil {
			module.Dir = module.Replace.Dir
		}
		if module.Dir == "" {
			log.Fatalf("module not downloaded: %s (run go mod download all)", module.Path)
		}
		entries, err := os.ReadDir(module.Dir)
		if err != nil {
			log.Fatal(err)
		}
		found := false
		for _, file := range entries {
			name := strings.ToUpper(file.Name())
			if file.IsDir() || !(strings.HasPrefix(name, "LICENSE") || strings.HasPrefix(name, "COPYING") || strings.HasPrefix(name, "NOTICE") || name == "PATENTS" || name == "AUTHORS") {
				continue
			}
			text, err := os.ReadFile(filepath.Join(module.Dir, file.Name()))
			if err != nil {
				log.Fatal(err)
			}
			fmt.Fprintf(&out, "\n--- %s %s / %s ---\n%s\n", module.Path, module.Version, file.Name(), text)
			found = true
		}
		if !found {
			log.Fatalf("license not found: %s", module.Path)
		}
	}
	if err := os.WriteFile(os.Args[2], out.Bytes(), 0644); err != nil {
		log.Fatal(err)
	}
}
