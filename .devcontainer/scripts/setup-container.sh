#!/usr/bin/env bash
set -euo pipefail

# GitHub CLI uses the host-mounted configuration. The credential helper is
# installed in the container user's Git config, never in the repository.
if gh auth status >/dev/null 2>&1; then
    gh auth setup-git
else
    printf 'GitHub CLI authentication is unavailable; run gh auth login on the host.\n' >&2
fi

go version
node --version
python3 --version
