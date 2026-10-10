# NHAX session diff

NHAXエクスポートに含まれる保存済みセッションを比較するツール。
同じユーザーの前後のセッションに加え、別名で保存したユーザー間でも比較できるようにする。

[Webアプリを開く](https://iuill.github.io/nhax-session-diff/) · [CLIをダウンロード](https://github.com/iuill/nhax-session-diff/releases/latest)

Web版ではNHAXを複数選び、ユーザー・セッションをまたいで左右のXML差分を比較する。
データ種別は初期表示でフィッティングに絞り、比較元・比較先それぞれのファイル・ユーザー・保存日時を選ぶ。
プロファイル・使用ログ・選択情報はデータ種別を切り替えて比較できる。
ファイルはブラウザ内で解析し、サーバーへ送信しない。差分をJSONで保存できる。
Go CLIとWebAssemblyは同じ解析を使う。設定名・単位との対応付けは未対応。

CLIはReleaseのZIP（Windows）またはtar.gz（Linux）を展開して使う。
Go・Python・Dockerのインストールは不要。CPUに合わせてamd64またはarm64を選ぶ。
WindowsではPowerShellで次のように実行する。

```powershell
.\nhax-diff.exe --version
.\nhax-diff.exe list --format text .\sample.nhax
.\nhax-diff.exe diff --before p0/s0/a0 --after p1/s0/a0 --format text .\sample.nhax
```

Linux版は静的リンクした実行ファイルで、glibc/muslに依存しない。
Linuxカーネル3.2以上、Windows 10以上を対象とする。
[GoのOS要件](https://go.dev/wiki/MinimumRequirements)を参照。
NHAXと変更メモの履歴は別の非公開リポジトリで管理する。
開発環境は [docs/development.md](docs/development.md) を参照。

## サンプルの置き場所

`local-data/sample.nhax` にコピーする。複数ファイルでもよい。
`local-data/` 全体とNHAX/ENHAXファイルはGit管理対象外。
実データを外部サービスへ送信せず、元ファイルを読み取り専用で解析する。

## 構造調査

Python 3.10以上。追加依存なし。

```bash
python3 tools/inspect_export.py local-data/sample.nhax
python3 tools/inspect_export.py local-data/sample.nhax --output local-data/inspection.json
python3 -m unittest discover -s tests
```

ファイルのサイズ、SHA-256、先頭16バイト、ZIPであればメンバー一覧、
XMLであればルートタグを報告する。ZIPの展開や設定値の解釈は行わない。
レポートのファイル名やタグにも個人情報が含まれる可能性があるため、解析結果も `local-data/` に保存する。

## セッション一覧と比較

```bash
go run ./cmd/nhax-diff list --format text local-data/sample.nhax
go run ./cmd/nhax-diff diff --before p0/s0/a6 --after p1/s0/a4 --format text local-data/sample.nhax
go run ./cmd/nhax-diff diff --before p0/s0/a6 --after p1/s0/a4 --format json local-data/sample.nhax
bash scripts/build.sh
```

引数はフラグを先、ファイルを後に指定する。比較時に2つ目のファイルを指定すると別エクスポートと比較できる。
CLIの標準出力はエージェント向けのJSONまたはコミットメッセージ作成用のテキスト。
`dist/nhax-diff` がローカルCLI、`dist/browser/` がブラウザ向け解析エンジンになる。

ソースからビルドする場合はGo 1.26以上が必要。次の方法でもインストールできる。

```bash
go install github.com/iuill/nhax-session-diff/cmd/nhax-diff@latest
nhax-diff list --format text local-data/sample.nhax
```

Python調査版も保持する。

```bash
python3 tools/session_diff.py local-data/sample.nhax --output local-data/sessions.json
python3 tools/session_diff.py local-data/sample.nhax --compare p0/s0/a6 p1/s0/a4 --output local-data/diff.json
```

一覧の `selector` を指定する。`p0/s0/a6` はファイル内の0番目のユーザー、
0番目のセッション、6番目のアクション。識別子は一覧内限定で、別エクスポートで変わりうる。
左右とXMLデータ種別が一致するアクション同士を比較する。
`--after-file local-data/other.nhax` を加えると別ファイルのアクションと比較できる。

比較対象はXMLの生の値。識別子やログの日時なども含むので、全差分を設定変更と解釈しない。
繰り返し要素は `Path` / `Key` / `Name` を使って対応付け、それらがない配列は順序で比較する。
差分ゼロは選択したXMLが一致することだけを示し、他のアクションや補聴器の現在値の一致を保証しない。
未対応形式はエラーを表示する。Python調査版は出力先が既に存在すると上書きを拒否する。
Go CLIは標準出力へ書くため、シェルで保存する場合は元のNHAXを出力先に指定しない。

## Web版の使い方

1. 1つ以上のエクスポートを読み込む。
2. ファイル・ユーザー・日時・セッションで一覧を確認する。
3. ユーザーをまたいで比較元と比較先を選ぶ。
4. 変更された設定項目を旧値 → 新値で表示し、左右・検索文字列で絞り込む。

未解読のデータは「未解読」と表示し、比較できた範囲を明示する。
詳細な要件と調査手順は [docs/design.md](docs/design.md) を参照。
