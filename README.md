# NHAX session diff

NHAXエクスポートに含まれる保存済みセッションを比較するツール。
同じユーザーの前後のセッションに加え、別名で保存したユーザー間でも比較できるようにする。

実サンプルで確認したNHAX形式から、ユーザー・セッション・アクションを一覧化し、
フィッティングXMLの項目を比較するGo CLIと共通解析パッケージを実装済み。
ブラウザ用WebAssemblyもビルド可能。画面の設定名・単位との対応付け、比較UI、Pages配信は未実装。

公開リポジトリにPages版とGo CLI版を置き、Goの共通解析をWebAssemblyでも使う。
NHAXと変更メモの履歴は別の非公開リポジトリで管理する。
Dev Containerの使い方とホスト認証共有は [docs/development.md](docs/development.md) を参照。

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

Go 1.26以上が必要。インストールして使う場合は次を実行する。

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

## 目指す使い方

1. 1つ以上のエクスポートを読み込む。
2. ファイル・ユーザー・日時・セッションで一覧を確認する。
3. ユーザーをまたいで比較元と比較先を選ぶ。
4. 変更された設定項目を旧値 → 新値で表示し、左右・プログラムで絞り込む。

未解読のデータは「未解読」と表示し、比較できた範囲を明示する。
詳細な要件と調査手順は [docs/design.md](docs/design.md) を参照。
