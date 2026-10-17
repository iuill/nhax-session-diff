#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist/browser
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION:-dev}" -o dist/nhax-diff ./cmd/nhax-diff
GOOS=js GOARCH=wasm go build -trimpath -o dist/browser/nhax.wasm ./cmd/nhax-wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" dist/browser/wasm_exec.js
cp web/index.html web/style.css web/app.js web/differences.js web/engine.js web/journal.js web/worker.js dist/browser/
