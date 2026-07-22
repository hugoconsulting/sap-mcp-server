# CHANGELOG — sap-mcp-server

記載は新しい順。バージョン管理ルールは HUGO-Design Issue #24 を正とする。
v0.1.0〜v0.9.0 は git tag 運用済（各 tag 時点の変更内容は git log 参照）。

## [0.12.2] - 2026-07-22
- 依存脆弱性修正（fast-uri 3.1.4。lockfile 更新の再スキャンで顕在化した 2 件を解消）
## [0.12.1] - 2026-07-22
- 依存脆弱性修正（Dependabot alert 7 件解消: hono 4.12.31 [high 含む] / esbuild 0.28.1 / body-parser 2.3.0）
## [0.12.0] - 2026-07-13
- `sap_list_destinations`: 応答を配列（`[...]`）から `{ "destinations": [...] }` オブジェクト形式に変更

## [0.11.0] - 2026-07-10
- `sap_call_ibp_api` 追加（SAP IBP OData API / relay→/call-ibp-api）。BasicAuthentication は Destination 側で解決。OData v2 は Accept: application/json を自動付与（$metadata 除く）。全 Communication Scenario の path を aiDescription に収載

## [0.10.0] - 2026-07-07
- `app_call_smartdb_api` 追加（外部アプリ SmartDB REST API v3 / Apps & Services・relay→/call-smartdb-api）。バインダトークン（静的 bearer）は Destination の URL.headers.Authorization で解決

## [0.9.1] - 2026-07-06
- `sap_call_calm_api` の説明に Cloud ALM ITSM 接続方法を詳細追記（記載漏れを 0.10.0 リリース時に補完）

## [0.9.0] - 2026-07-05
- バージョン管理ルール統一（HUGO-Design#24）。CHANGELOG.md 運用を開始（tag v0.9.0 は付与済）
