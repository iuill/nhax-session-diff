NHAXエクスポートをローカルで解析・比較するGUIとCLIです。Go・Python・Dockerのインストールは不要です。

- 保存済みユーザー・セッション・アクションの一覧表示
- 同一ファイル内、別ファイル、別名のユーザー間でのXML項目比較
- JSON・テキスト出力
- Windows GUIで比較、設定・変更の意図、使用後の気づきを記録

Windowsの画面付きアプリは **`nhax-desktop_windows_amd64.exe`** をダウンロードしてダブルクリックで起動します。
WebView2 Runtimeが必要です。未導入の場合は初回起動時にインストールを案内します。
記録の保存先には、NHAXを管理する別の非公開履歴リポジトリなどを選択します。
記録は `journal/` にJSONで保存され、選択中の履歴も添付できます。Gitへのcommit・pushは別途行ってください。
exeは履歴リポジトリのGit管理対象にする必要はありません。
`SHA256SUMS-desktop` と `THIRD-PARTY-NOTICES-desktop.txt` も添付しています。
GUI版はWindows amd64向けです。以下のアーカイブはCLI版です。

Web版: https://iuill.github.io/nhax-session-diff/

## 配布物

| OS / CPU | 配布形式 |
| --- | --- |
| Linux / Intel・AMD 64bit | `linux_amd64.tar.gz` |
| Linux / ARM 64bit | `linux_arm64.tar.gz` |
| Windows / Intel・AMD 64bit | `windows_amd64.zip` |
| Windows / ARM 64bit | `windows_arm64.zip` |

Windowsは展開した `nhax-diff.exe` をPowerShell等から実行します。
Linuxは展開した `nhax-diff` を `./nhax-diff` として実行します。
チェックサムは `SHA256SUMS` に記載しています。

Linux版は `CGO_ENABLED=0` でビルドした静的リンクのELF実行ファイルです。
glibc / muslに依存せず、同じCPUアーキテクチャのディストリビューションで利用できます。
Go 1.26の実行要件としてLinuxカーネル3.2以降、Windows 10以降が必要です。
Linux amd64とWindows amd64で実行検証しています。arm64版はクロスビルド済みですが、このリリースでは実機検証していません。
[Goの実行要件](https://go.dev/wiki/MinimumRequirements)

現在は確認済みのNHAX形式に対応します。XMLの値を比較するもので、画面上の設定名・単位・プログラムとの対応は未検証です。
