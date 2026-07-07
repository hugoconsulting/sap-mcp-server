# CHANGELOG — sap-mcp-server

記載は新しい順。バージョン管理ルールは HUGO-Design Issue #24 を正とする。
v0.1.0〜v0.9.0 は git tag 運用済（各 tag 時点の変更内容は git log 参照）。

## [0.10.0] - 2026-07-07
- `app_call_smartdb_api` 追加（外部アプリ SmartDB REST API v3 / Apps & Services・relay→/call-smartdb-api）。バインダトークン（静的 bearer）は Destination の URL.headers.Authorization で解決

## [0.9.1] - 2026-07-06
- `sap_call_calm_api` の説明に Cloud ALM ITSM 接続方法を詳細追記（記載漏れを 0.10.0 リリース時に補完）

## [0.9.0] - 2026-07-05
- バージョン管理ルール統一（HUGO-Design#24）。CHANGELOG.md 運用を開始（tag v0.9.0 は付与済）
