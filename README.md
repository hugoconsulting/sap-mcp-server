# sap-mcp-server

> SAP（ABAP / BTP）を MCP 対応 AI クライアントから操作するための Model Context Protocol サーバ。
> An independent, open-source MCP server for SAP, distributed as a single self-contained binary.

`Claude Code` / `Cursor` / その他 MCP 対応クライアントから、SAP の ABAP・BTP 系 API を
横断的に呼び出すための MCP サーバです。実通信はユーザ環境のバックエンド（relay）経由で行う
薄いラッパー構成で、配布は **Node.js SEA による単一バイナリ**で提供します。

> ⚠️ **Scaffold 段階です。** 本リポジトリは公開準備中の実装雛形であり、
> サーバ本体（`src/`）はこれから実装します。一般公開（public 化）は準備完了後に行います。

---

## 特長

- 単一バイナリ配布（Node ランタイム不要）— Linux / Windows
- 接続情報はローカルの `connections.json` で管理（リポジトリには含めない）
- 環境タグ（DEV / QAS / PRD）による操作スコープ制御を想定

## インストール

GitHub Release の Assets からプラットフォーム別バイナリを取得します。

```bash
# 例（public 化後に有効）
curl -fsSL https://github.com/HUGO-Domon/sap-mcp-server/releases/latest/download/install-sap-mcp.sh | bash
```

> 配布バイナリは未署名の場合があります。Windows SmartScreen / macOS Gatekeeper の
> 警告と回避手順は [docs/](docs/) を参照してください。各 Asset には `*.sha256` を添付します。

## 設定

`connections.example.json` をコピーして `connections.json` を作成し、自環境の値を設定します。

```bash
cp connections.example.json ~/.config/sap-mcp-server/connections.json
```

探索順: `$SAP_MCP_CONFIG` → `~/.config/sap-mcp-server/connections.json` → 実行ファイル近傍。

## ビルド（開発者向け）

```bash
npm ci
npm run bundle        # esbuild で CJS バンドル
npm run build:sea     # Node SEA blob 生成 → postject でバイナリ化
```

## セキュリティ

脆弱性の報告は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

[Apache License 2.0](LICENSE)。SAP および SAP 製品名は SAP SE の商標です。
本プロジェクトは SAP SE とは無関係であり、SAP SE による承認・後援を受けていません。
詳細は [NOTICE](NOTICE) を参照してください。
