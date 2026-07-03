// SPDX-License-Identifier: Apache-2.0
/**
 * BTP サービス API ツール群
 *
 * バックエンド（relay）の /call-<category> エンドポイントを経由し、
 * IAS Admin / IPS Jobs / CF API v3 / BWZ Content / cTMS / Forms / CIS / CPI
 * の REST API を Destination 経由で呼び出す。
 *
 * destination の有効性検査はバックエンド側で実施する。
 */

import { relay } from './destinations.js';
import type { ConnectionConfig } from './config.js';

export interface BtpCallArgs {
  destination: string;
  method?:     'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  path:        string;
  query?:      Record<string, string | number | boolean | string[] | undefined>;
  body?:       any;
  headers?:    Record<string, string>;
  timeoutMs?:  number;
}

async function _call(connection: ConnectionConfig, endpoint: string, args: BtpCallArgs) {
  if (!args.destination) throw new Error('destination が必要です');
  if (!args.path)        throw new Error('path が必要です');
  return relay(connection, endpoint, {
    destination: args.destination,
    method:      (args.method || 'GET').toUpperCase(),
    path:        args.path,
    query:       args.query,
    body:        args.body,
    headers:     args.headers,
    timeoutMs:   args.timeoutMs,
  });
}

// SCIM 系 path は Accept: application/scim+json が必須 (default Accept → 406)
// IAS Identity Directory: /scim/v2/*, 旧 SCIM v1: /scim/*, IPS SCIM proxy: /api/v1/scim/{SystemId}/*
function _ensureScimAcceptHeader(args: BtpCallArgs): BtpCallArgs {
  const isScim = args.path.startsWith('/scim') || args.path.includes('/api/v1/scim/');
  if (!isScim) return args;
  // ユーザー指定 Accept があれば尊重（spread 順で後勝ち）
  const headers = { Accept: 'application/scim+json', ...(args.headers || {}) };
  return { ...args, headers };
}

// IAS Admin API (SCIM Users / Groups / Applications / Schemas / Tenant Setting)
export async function callIasAdmin(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-ias-admin', _ensureScimAcceptHeader(args));
}

// IPS Jobs / JobLogs（IAS Destination を流用）
export async function callIpsJob(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-ips-job', _ensureScimAcceptHeader(args));
}

// Cloud Foundry API v3 (apps / orgs / spaces / service_instances / service_bindings ...)
export async function callCfApi(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-cf-api', args);
}

// Build Work Zone Content API (tiles / groups / roles / pages / content_packages)
export async function callBwzContent(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-bwz-content', args);
}

// Cloud Transport Management v2 API (nodes / transportRequests / imports / queues)
export async function callCtmsApi(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-ctms-api', args);
}

// Forms Service by Adobe REST API (/v1/forms / ADS 操作)
export async function callFormsApi(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-forms-api', args);
}

// SAP Cloud Information Service (CIS Central) / Global Account / Subaccount 等
export async function callCisApi(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-cis-api', args);
}

// SAP Integration Suite (CPI) Audit API / iFlow / Channel / Logs
export async function callCpiApi(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-cpi-api', args);
}

// SAP Alert Notification Service REST API（Configuration / Producer / Consumer 全 API）
export async function callAnsApi(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-ans-api', args);
}

// SAP Build Process Automation REST API（Workflow / Process / Task 全 API）
export async function callSbpaApi(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-sbpa-api', args);
}

// SAP Datasphere REST API（dwaas-core / SCIM・Technical User OAuth2ClientCredentials）
export async function callDatasphereApi(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-datasphere-api', args);
}

// SAP Cloud ALM REST API（Landscape / Analytics / Tasks / Projects 等・全 API）
export async function callCalmApi(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-calm-api', args);
}

// 外部アプリ JIRA REST API（Apps & Services）。mTLS(ClientCertificate)+bearer は
// Destination 側で解決するため、呼出側は path/method/body のみ指定する。
export async function callJiraApi(connection: ConnectionConfig, args: BtpCallArgs) {
  return _call(connection, '/call-jira-api', args);
}

// SAP CLI 実行（btp / cf / Datasphere）。公開 REST 不在の操作（例: ロールコレクション↔User Group
// 割当）を CLI 経由で実行する。relay → connection-backend /internal/cli で直列実行される。
// 設計: 1016_アプリ設計/_共通機能の設計/10_CLI実行層_設計.md
export interface CliCallArgs {
  service:    'btp' | 'cf' | 'datasphere';
  destination: string;
  args:       string[];
  timeoutMs?: number;
}
export async function callCli(connection: ConnectionConfig, a: CliCallArgs) {
  if (!a.destination) throw new Error('destination が必要です');
  if (!Array.isArray(a.args) || a.args.length === 0) throw new Error('args（CLI 引数配列）が必要です');
  return relay(connection, '/call-cli', {
    service:     a.service,
    destination: a.destination,
    args:        a.args,
    timeoutMs:   a.timeoutMs,
  });
}
