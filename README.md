# sap-mcp-server

**English** | [日本語](README.ja.md)

> Securely operate SAP ABAP and BTP services from MCP-compatible AI clients.

Connect to SAP **ABAP** and **BTP services** from general MCP-compatible AI clients such as
**Claude Code**, **Codex**, and **Gemini CLI**. Distributed as a single self-contained binary
(Node.js SEA) for Linux and Windows.

> This tool is **not standalone**: it requires a backend service deployed on **SAP BTP, Cloud Foundry**.
> Through strong, multi-layered security it accesses **on-premise / RISE** SAP environments.

---

## 🔒 Security

Security is enforced in **multiple layers (defense in depth)**, so AI-driven access to SAP
stays controlled and auditable.

| Layer | Control |
|---|---|
| **Access scope** | Restrict access to **Full** or **Reference-only (read-only)**. |
| **Landscape** | Per-landscape access control for **DEV / QAS / PRD**. |
| **Authentication** | Connects only over a secure, authenticated channel; SAP credentials are never held by the client. |
| **Secret handling** | Connection secrets are kept **local only** and are **never** committed or embedded in the binary. |

### Security pattern: role-based authorization

Two scopes — `mcp` (**Full**) and `mcp_readonly` (**Reference-only**) — are enforced in layers (the reference backend implements this; bring-your-own backends are encouraged to follow it):

1. **Scope gate (app level)** — every MCP route is mounted behind "require `mcp` *or* `mcp_readonly`"; a token with neither scope is rejected (403) before any handler runs.
2. **Environment gate (per destination)** — each destination is tagged `DEV` / `QAS` / `PRD`. `mcp_readonly` may reach only `DEV`/`QAS` (PRD and untagged are denied — fail-closed). `mcp` reaches all.
3. **Method gate (REST relays)** — `mcp_readonly` may issue only `GET` on the BTP service relays.
4. **Hard-deny** — PII tools (IAS / IPS) and CLI execution are `mcp`-only, regardless of environment.

| Tool | Full (`mcp`) | Read-only (`mcp_readonly`) |
|---|---|---|
| `sap_list_destinations` | all | DEV/QAS destinations only |
| `sap_select_table` | all envs | DEV/QAS only |
| `sap_call_fm` (incl. `commit`) | all envs | DEV/QAS only |
| `sap_adt_freestyle` / `osql` / `ddic` | all envs | DEV/QAS only |
| `sap_abap_read_source` | all envs | DEV/QAS only |
| `sap_abap_write_source` / `write_fm` / `delete_source` / `activate` (writes) | DEV-role destinations only | **denied** |
| `sap_create_transport` / `sap_release_transport` | DEV-role destinations only | **denied** |
| `sap_call_ias_admin` (IAS · PII) | all envs | **denied** |
| `sap_call_ips_job` (IPS · PII) | all envs | **denied** |
| `sap_call_cf_api` / `bwz_content` / `ctms_api` / `forms_api` / `cis_api` / `cpi_api` | all envs, any method | `GET` + DEV/QAS only |
| `sap_call_btp_cli` / `cf_cli` / `datasphere_cli` | all envs | **denied** |

Operational controls (defense in depth): (1) MCP key issuance, (2) scope `mcp` / `mcp_readonly`, (3) key revoke, (4) audit log of every call, (5) per-destination environment tag.

## Capabilities

- **SAP ABAP**
  - **Run any remote-enabled Function Module / BAPI without cumbersome web service configuration.**
  - Function Modules (RFC / BAPI)
  - Table read (RFC_READ_TABLE-equivalent)
  - ADT SQL / Open SQL / DDIC preview
  - **Add-on development** — read / write / activate / delete reports and function modules (SE37) via ADT
  - **Transport management** — create / release transport requests (CTS)
- **SAP BTP services**
  - Cloud Identity Services (IAS) Admin / SCIM
  - Identity Provisioning (IPS) Jobs / JobLogs
  - Cloud Foundry API v3
  - Build Work Zone (Content API)
  - Cloud Transport Management (cTMS) v2
  - Forms Service by Adobe
  - Cloud Information Service (CIS Central)
  - Integration Suite (CPI) Audit / Monitoring

## Install

Download the platform binary from GitHub Releases.

```bash
curl -fsSL https://github.com/HUGO-Domon/sap-mcp-server/releases/latest/download/install-sap-mcp.sh | bash
```

> Binaries may be unsigned. See [docs/](docs/) for Windows SmartScreen / macOS Gatekeeper notes.
> Each asset ships with a `*.sha256` checksum.

## Configuration

Copy `connections.example.json` to `connections.json` and fill in your environment.

```bash
cp connections.example.json ~/.config/sap-mcp-server/connections.json
```

Lookup order: `$SAP_MCP_CONFIG` → `~/.config/sap-mcp-server/connections.json` → next to the executable.

## Client Configuration

Register this server in your AI client's MCP configuration file. Replace the binary path (`command`) according to your environment.

### Gemini CLI (`~/.gemini/settings.json`)

```json
{
  "mcpServers": {
    "sap-abap": {
      "command": "/path/to/sap-mcp-server-linux",
      "args": []
    }
  }
}
```

### Claude Desktop
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sap-abap": {
      "command": "C:\\path\\to\\sap-mcp-server-win.exe",
      "args": []
    }
  }
}
```

### Claude Code (CLI)
The `install-sap-mcp.sh` script automatically registers the server in `~/.claude.json`.

## Build (developers)

```bash
npm ci
npm run build:bundle    # esbuild → CJS bundle
npm run build:bin:linux # Node SEA blob + postject → single binary
```

## Backend

Actual SAP communication and the security controls above are performed by a **backend** that this
server connects to over a secure channel. A **compatible backend is required** (Bring Your Own Backend).

- The REST contract a backend must satisfy is defined in [docs/BACKEND-CONTRACT.md](docs/BACKEND-CONTRACT.md).
- A reference backend is **not** included in this repository. A production-ready backend
  (setup, connection configuration, and operation) is **provided separately under a consulting engagement**.
  Contact: contact@hugoconsulting.com

## Security Policy

Please report vulnerabilities via [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE).
"SAP" and SAP product names are trademarks of SAP SE. This project is not affiliated with,
endorsed by, or sponsored by SAP SE. See [NOTICE](NOTICE).
