#!/usr/bin/env bash
set -euo pipefail

codex_binary="${HOME}/.codex/packages/standalone/current/bin/codex"
if [[ ! -x "$codex_binary" ]]; then
    printf 'Host Codex standalone binary was not found: %s\n' "$codex_binary" >&2
    exit 1
fi
"$codex_binary" --version >/dev/null

# Check bind sources without reading, copying, or changing credentials.
if [[ ! -f "${HOME}/.codex/auth.json" ]]; then
    printf 'Sign in to Codex on the host first; ~/.codex/auth.json is required.\n' >&2
    exit 1
fi
if [[ ! -d "${HOME}/.config/gh" ]]; then
    printf 'Run gh auth login on the host first; ~/.config/gh is required.\n' >&2
    exit 1
fi
