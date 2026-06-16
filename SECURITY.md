# Security Policy

## 脆弱性の報告 / Reporting a Vulnerability

セキュリティ上の問題を見つけた場合は、**公開 Issue を立てず**、GitHub の
[Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
（Security タブ → Report a vulnerability）からご連絡ください。

- 初回応答: 5 営業日以内を目標
- 連絡先: `<SECURITY_CONTACT>`（確定後に置換）

## 取り扱い上の注意 / Handling

本サーバは SAP システムへの接続情報（client secret 等）を扱います。

- `connections.json` は**絶対にコミットしない**（`.gitignore` 済み）
- 配布バイナリに接続情報や認証情報は埋め込まれません
- 本番（PRD）接続は最小権限のサービスユーザを用い、環境タグで操作スコープを制限してください
