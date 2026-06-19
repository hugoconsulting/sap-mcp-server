# sap-mcp-server

[English](README.md) | **日本語**

> MCP 対応 AI クライアントから SAP ABAP / BTP サービスを **安全に** 操作するための Model Context Protocol サーバ。

**Claude Code** / **Codex** / **Gemini CLI** などの汎用的な MCP 対応クライアントから、SAP の
**ABAP** および **BTP サービス**へ接続できます。配布は **Node.js SEA による単一バイナリ**（Linux / Windows）です。

> 本ツールは **単体では動作せず**、**SAP BTP, Cloud Foundry** への Backend サービスの配置を必要とします。
> 強固な多層セキュリティで **On-Premise / RISE** の SAP 環境へアクセスします。

---

## 🔒 セキュリティ

SAP への AI アクセスを統制・監査可能に保つため、セキュリティは **多段階（多層防御）** で強化されています。

| 層 | 制御 |
|---|---|
| **権限制御** | 操作を **フル** か **参照のみ（read-only）** に権限制御できます。 |
| **ランドスケープ** | **DEV / QAS / PRD** のランドスケープごとにアクセスを制御できます。 |
| **認証** | セキュアな認証付き接続でのみアクセス。SAP の資格情報をクライアントが保持しません。 |
| **機密管理** | 接続情報はローカルのみで管理し、リポジトリやバイナリに **埋め込みません**。 |

### セキュリティパターン: ロール別認可

`mcp`（**フル**）と `mcp_readonly`（**参照のみ**）の 2 スコープを多層で制御します（リファレンス backend が実装。BYO backend でも踏襲を推奨）:

1. **スコープゲート（app 層）** — 全 MCP route を「`mcp` *または* `mcp_readonly` 必須」でマウント。どちらの scope も持たないトークンは handler 到達前に 403。
2. **環境ゲート（Destination 単位）** — 各 Destination に `DEV` / `QAS` / `PRD` タグ。`mcp_readonly` は `DEV`/`QAS` のみ到達可（PRD・未設定は拒否＝fail-closed）。`mcp` は全環境。
3. **メソッドゲート（REST relay）** — `mcp_readonly` は BTP relay で `GET` のみ。
4. **完全拒否** — PII ツール（IAS / IPS）と CLI 実行は環境を問わず `mcp` 限定。

| ツール | フル（`mcp`） | 参照のみ（`mcp_readonly`） |
|---|---|---|
| `sap_list_destinations` | 全件 | DEV/QAS の Destination のみ |
| `sap_select_table` | 全環境 | DEV/QAS のみ |
| `sap_call_fm`（`commit` 含む） | 全環境 | DEV/QAS のみ |
| `sap_adt_freestyle` / `osql` / `ddic` | 全環境 | DEV/QAS のみ |
| `sap_call_ias_admin`（IAS・PII） | 全環境 | **拒否** |
| `sap_call_ips_job`（IPS・PII） | 全環境 | **拒否** |
| `sap_call_cf_api` / `bwz_content` / `ctms_api` / `forms_api` / `cis_api` / `cpi_api` | 全環境・全メソッド | `GET` + DEV/QAS のみ |
| `sap_call_btp_cli` / `cf_cli` / `datasphere_cli` | 全環境 | **拒否** |

統制点（多層防御）: (1) MCP キー発行 (2) scope `mcp` / `mcp_readonly` (3) キー失効 (4) 全呼出の監査ログ (5) Destination 単位の環境タグ。

## できること

- **SAP ABAP**
  - **煩雑な Web サービス設定なしで、任意の汎用モジュール（RFC 対応 FM）/ BAPI のリモート実行を可能にします。**
  - 汎用モジュール（RFC / BAPI）
  - テーブル読取（RFC_READ_TABLE 相当）
  - ADT SQL / Open SQL / DDIC プレビュー
- **SAP BTP サービス**
  - Cloud Identity Services (IAS) Admin / SCIM
  - Identity Provisioning (IPS) Jobs / JobLogs
  - Cloud Foundry API v3
  - Build Work Zone（Content API）
  - Cloud Transport Management (cTMS) v2
  - Forms Service by Adobe
  - Cloud Information Service (CIS Central)
  - Integration Suite (CPI) Audit / Monitoring

## インストール

GitHub Release の Assets からプラットフォーム別バイナリを取得します。

```bash
curl -fsSL https://github.com/HUGO-Domon/sap-mcp-server/releases/latest/download/install-sap-mcp.sh | bash
```

> 配布バイナリは未署名の場合があります。Windows SmartScreen / macOS Gatekeeper の注意は [docs/](docs/) を参照。
> 各 Asset には `*.sha256` チェックサムを添付します。

## 設定

`connections.example.json` をコピーして `connections.json` を作成し、自環境の値を設定します。

```bash
cp connections.example.json ~/.config/sap-mcp-server/connections.json
```

探索順: `$SAP_MCP_CONFIG` → `~/.config/sap-mcp-server/connections.json` → 実行ファイル近傍。

## ビルド（開発者向け）

```bash
npm ci
npm run build:bundle    # esbuild → CJS バンドル
npm run build:bin:linux # Node SEA blob + postject → 単一バイナリ
```

## バックエンド

実際の SAP 通信と上記のセキュリティ制御は、本サーバが **セキュアな接続** で接続する **バックエンド** が担います。
利用には **互換バックエンドが必要** です（Bring Your Own Backend）。

- バックエンドが満たすべき REST 契約は [docs/BACKEND-CONTRACT.md](docs/BACKEND-CONTRACT.md) を参照してください。
- リファレンスバックエンドは本リポジトリには含まれません。導入支援・本番運用向けのバックエンドは
  **別途コンサルティング契約にて提供**します。お問い合わせ: contact@hugoconsulting.com

## セキュリティ報告

脆弱性の報告は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

[Apache License 2.0](LICENSE)。SAP および SAP 製品名は SAP SE の商標です。本プロジェクトは
SAP SE とは無関係であり、承認・後援を受けていません。詳細は [NOTICE](NOTICE) を参照してください。
