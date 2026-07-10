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

The binary reads a `connections.json` describing one or more backend connections. It is read by the
**binary itself** (independent of the AI client), in this lookup order:

`$SAP_MCP_CONFIG` → `~/.config/sap-mcp-server/connections.json` → next to the executable.

### connections.json format

```json
{
  "defaultConnection": "primary",
  "connections": {
    "primary": {
      "defaultDestination": "AC1",
      "relayUrl": "https://your-backend.example.com",
      "relayBasePath": "/api/tableread/mcp",
      "clientId": "sb-xxxxxxxx",
      "clientSecret": "xxxxxxxx",
      "tokenUrl": "https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token"
    }
  }
}
```

| Field | Required | Description |
|---|---|---|
| `defaultConnection` | optional | Connection used when a tool call omits `connection`. Defaults to the first entry. |
| `defaultDestination` | optional | SAP destination (SID / Destination name) used when a tool call omits `destination`. |
| `relayUrl` | **required** | Base URL of the **backend** (the backend host itself, **not** the approuter). No trailing slash. |
| `relayBasePath` | **required*** | Path where the backend mounts the MCP relay. **It must match your backend.** The provided reference backend mounts it at **`/api/tableread/mcp`**. |
| `clientId` / `clientSecret` | **required** | OAuth2 `client_credentials` of the XSUAA service key that protects the backend. |
| `tokenUrl` | **required** | XSUAA token endpoint (ends with `/oauth/token`). |

> ⚠ **Most common failure — "cannot connect / tools return 404".**
> If `relayBasePath` is omitted it defaults to `/api/mcp`, which does **not** match the reference
> backend (mounted at `/api/tableread/mcp`), so every relay call 404s. Always set `relayBasePath`
> to your backend's actual MCP mount path.

### Getting the values (recommended)

Ask your backend administrator to issue you an MCP key. In the reference backend's **MCP admin** app,
open your approved request and click **"Get credentials"**. The dialog shows every field and provides:

- **Copy all** — copies the complete `connections.json` to the clipboard, and
- **Download connections.json** — saves a ready-to-use file.

`relayUrl`, `relayBasePath`, `clientId`, `clientSecret`, and `tokenUrl` are already filled in; you only
set **`defaultDestination`** (and optionally the connection name) in the dialog before copying/downloading.

> Credentials are shown **once**. If you miss them, ask the admin to **rotate** the key.

### Create / update the file

```bash
mkdir -p ~/.config/sap-mcp-server
# New install — move the downloaded file into place:
mv ~/Downloads/connections.json ~/.config/sap-mcp-server/connections.json
chmod 600 ~/.config/sap-mcp-server/connections.json
```

To add another landscape, add a second entry under `connections` (e.g. `"dev"`, `"prd"`), then either
set `defaultConnection` or pass the `connection` argument per tool call. Keep secrets **local only** —
never commit `connections.json`.

## Client Configuration

Register the binary in your AI client, then **restart the client** (or reconnect its MCP servers) so it
reloads. The MCP server name is arbitrary; `sap-mcp-server` is used below.

### Claude Code (CLI)

`install-sap-mcp.sh` auto-registers the server in `~/.claude.json`. To register manually:

```bash
claude mcp add sap-mcp-server -- /path/to/sap-mcp-server-linux
```

…or edit `~/.claude.json` directly:

```json
{ "mcpServers": { "sap-mcp-server": { "command": "/path/to/sap-mcp-server-linux", "args": [] } } }
```

Verify with **`/mcp`** inside Claude Code — it should list `sap-mcp-server` as connected. After you
**update the binary or `connections.json`**, run `/mcp` → reconnect (or restart Claude Code) to pick up
the change.

### Claude Desktop
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{ "mcpServers": { "sap-mcp-server": { "command": "C:\\path\\to\\sap-mcp-server-win.exe", "args": [] } } }
```

Restart Claude Desktop after editing.

### Gemini CLI (`~/.gemini/settings.json`)

```json
{ "mcpServers": { "sap-mcp-server": { "command": "/path/to/sap-mcp-server-linux", "args": [] } } }
```

Restart the Gemini CLI session after editing. (The binary still reads `connections.json` from the lookup
order above — the client config only points at the binary.)

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
