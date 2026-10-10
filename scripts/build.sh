#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist/browser
go build -trimpath -o dist/nhax-diff ./cmd/nhax-diff
GOOS=js GOARCH=wasm go build -trimpath -o dist/browser/nhax.wasm ./cmd/nhax-wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" dist/browser/wasm_exec.js
