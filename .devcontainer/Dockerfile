FROM mcr.microsoft.com/devcontainers/go:2.1.6-1.26-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/vscode/.codex /home/vscode/.config/gh \
    && chown -R vscode:vscode /home/vscode/.codex /home/vscode/.config
