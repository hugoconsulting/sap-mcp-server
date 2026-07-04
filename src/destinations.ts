// SPDX-License-Identifier: Apache-2.0
import fetch from 'node-fetch';
import type { ConnectionConfig } from './config.js';

// 接続単位のトークンキャッシュ（簡易・有効期限 5 分マージン）
interface CachedToken { token: string; expiresAt: number; }
const tokenCache = new Map<string, CachedToken>();

const DEFAULT_BASE_PATH = '/api/mcp';

async function getToken(connection: ConnectionConfig): Promise<string> {
  const cached = tokenCache.get(connection.id);
  const now = Date.now();
  if (cached && cached.expiresAt - 5 * 60 * 1000 > now) return cached.token;

  const auth = Buffer.from(`${connection.clientId}:${connection.clientSecret}`).toString('base64');
  const res = await fetch(connection.tokenUrl, {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body:    'grant_type=client_credentials',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OAuth2 token 取得失敗 [${res.status}]: ${t.slice(0, 200)}`);
  }
  const data: any = await res.json();
  const token = data.access_token as string;
  const expiresInSec = data.expires_in || 43200;
  tokenCache.set(connection.id, { token, expiresAt: now + expiresInSec * 1000 });
  return token;
}

async function relay(connection: ConnectionConfig, path: string, body: any, timeoutMs = 110000): Promise<any> {
  const token = await getToken(connection);
  const base  = (connection.relayBasePath || DEFAULT_BASE_PATH).replace(/\/+$/, '');
  const url   = `${connection.relayUrl.replace(/\/+$/, '')}${base}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
        'X-MCP-User':    connection.mcpUser || `mcp:${connection.id}`,
      },
      body:    JSON.stringify(body || {}),
      signal:  controller.signal as any,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 401 はトークンキャッシュを破棄して 1 回だけリトライ
    if (res.status === 401) {
      tokenCache.delete(connection.id);
      throw new Error(`relay ${path} HTTP 401 (token reset, retry next call): ${text.slice(0, 200)}`);
    }
    throw new Error(`relay ${path} HTTP error [${res.status}]: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function listDestinations(connection: ConnectionConfig) {
  const data: any = await relay(connection, '/list-destinations', {});
  return data.items || [];
}

export { relay };
