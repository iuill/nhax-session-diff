# 開発環境

対象チェックアウトのルートで実行する。
Dev Containerを使う場合は、VS Codeの「Reopen in Container」で開き、コンテナ内のターミナルで同じコマンドを実行する。

```bash
python3 -m unittest discover -s tests
go version
node --version
gh auth status
go test ./...
go vet ./...
bash scripts/build.sh
```

Go 1.26、Node.js 24、Python 3、GitHub CLIを用意する。
CLIの利用にはGoのみ必要。Node.jsはブラウザ用アダプターの検証、Pythonは調査版の検証に使う。
現在のDev Container定義はLinuxホスト上のCodex standaloneとファイル形式の認証キャッシュを共有する開発者向け設定。
この方式を使わない場合は、ホスト共有用のmounts・remoteEnv・initializeCommandを外し、必要なツールをコンテナ内で用意する。
Goをローカルに用意して開発する場合、Dev Containerと認証共有は不要。

## ホストのCodex・認証共有

- `~/.codex/packages/standalone/` を同じ絶対パスへ読み取り専用マウントし、`current/bin` をPATHへ追加。
  ホストのCodex更新が反映され、コンテナへの別インストールは不要。
- `~/.codex/auth.json` をコンテナの `/home/vscode/.codex/auth.json` へマウント。
  トークン更新を反映するため書き込み可能で共有する。
- `~/.config/gh/` を `/home/vscode/.config/gh/` へマウント。
  コンテナ側のGit credential helperを `gh auth setup-git` で設定する。
- 認証ファイルをビルドコンテキストへコピーしない。ホストのCodex設定全体も共有しない。
- ホスト側で先にCodexとGitHub CLIへログインする。ホストの資格情報がOSのkeyringだけに保存されている場合は、このファイル共有方式では利用できない。
- 認証を共有するため、コンテナ内でのlogoutなどはホストにも影響する。

認証キャッシュの説明: [OpenAI公式ドキュメント](https://learn.chatgpt.com/docs/auth#login-caching)。

## アプリの構成方針

- 公開の `nhax-session-diff` は、Goの共通解析パッケージ、CLI、PagesのWeb画面を持つ。
- CLIとWebAssemblyから同じGoパッケージを使う。UIやファイル操作は共通解析から分離する。
- NHAXはブラウザ内またはCLIの実行環境で解析する。Pagesへ送信するAPIは設けない。
- Python実装は調査用の参照として保持し、Go実装の移行検証に使う。
  共通パッケージは `internal/nhax`、CLIは `cmd/nhax-diff`、ブラウザアダプターは `cmd/nhax-wasm`。
- 非公開の履歴リポジトリはNHAXと変更メモを管理する別リポジトリ。
- 履歴リポジトリのエージェントはCLIで比較し、その結果からコミットメッセージを作る。
  比較元は明示し、未検証の項目の意味や単位を推測しない。

Goのブラウザ向けビルドは `GOOS=js GOARCH=wasm` を使う。
[Go公式WebAssemblyガイド](https://go.dev/wiki/WebAssembly)を参照。

ブラウザアダプターは `nhaxParse(Uint8Array)` と
`nhaxCompare(beforeBytes, beforeSelector, afterBytes, afterSelector)` を公開し、
JSON文字列の `{result: ...}` または `{error: ...}` を返す。
CLIとの一致は `node scripts/check-wasm.cjs FILE BEFORE AFTER EXPECTED_JSON` で検証できる。
