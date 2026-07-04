// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SEA (Single Executable Application) 経由でビルドした場合 import.meta が空になるため、
// HOME / argv[1] からも候補を組み立てる。
function _detectScriptDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (import.meta as any)?.url;
    if (url) return path.dirname(fileURLToPath(url));
  } catch { /* SEA / CJS */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dn = (globalThis as any).__dirname;
  if (dn) return dn;
  if (process.argv[1]) return path.dirname(process.argv[1]);
  return process.cwd();
}

export interface ConnectionConfig {
  id:           string;
  defaultDestination?: string;
  // バックエンド（relay）の直接 URL（approuter ではなく backend host）
  // 例: https://your-backend.example.com
  relayUrl:     string;
  // relay の base path（既定 /api/mcp）。バックエンドの公開パスに合わせて上書き可。
  relayBasePath?: string;
  // OAuth2 client_credentials の資格情報（バックエンドを保護する XSUAA service-key 等）
  clientId:     string;
  clientSecret: string;
  tokenUrl:     string;       // 例: https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token
  // relay の X-MCP-User に載せる識別子（省略時 mcp:<接続id>）。HTTP エッジが本人 email/sub を注入する用途。
  mcpUser?:     string;
}

export interface AppConfig {
  defaultConnection?: string;
  connections: Record<string, Omit<ConnectionConfig, 'id'>>;
}

export function loadConfig(): AppConfig {
  const here = _detectScriptDir();
  // SAP_MCP_CONFIG 最優先 → ~/.config/sap-mcp-server/connections.json → script dir 配下
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    process.env.SAP_MCP_CONFIG,
    home ? path.join(home, '.config', 'sap-mcp-server', 'connections.json') : null,
    path.join(here, '..', 'connections.json'),
    path.join(here, 'connections.json'),
  ].filter(Boolean) as string[];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    throw new Error(`connections.json が見つかりません。次のいずれかに配置してください:\n${candidates.join('\n')}`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

export function getConnection(cfg: AppConfig, id?: string): ConnectionConfig {
  const cid = id || cfg.defaultConnection;
  if (!cid) throw new Error('接続キー未指定（defaultConnection 未設定）');
  const c = cfg.connections[cid];
  if (!c) throw new Error(`接続 "${cid}" が connections.json にありません`);
  for (const k of ['relayUrl', 'clientId', 'clientSecret', 'tokenUrl'] as const) {
    if (!c[k]) throw new Error(`接続 "${cid}" の ${k} が未設定`);
  }
  return { id: cid, ...c };
}
