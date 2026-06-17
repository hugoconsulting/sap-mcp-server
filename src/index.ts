#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig, getConnection }               from './config.js';
import { listDestinations }                        from './destinations.js';
import { callFm, callSelectTable, callAdtFreestyle, callAdtOsql, callAdtDdic } from './abap.js';
import {
  callIasAdmin, callIpsJob, callCfApi, callBwzContent, callCtmsApi,
  callFormsApi, callCisApi, callCpiApi, callCli,
} from './btp.js';
import { setDestination, getCurrentDestination }   from './session.js';
import { VERSION }                                  from './version.js';

// --version は connections.json 不要で応答する（loadConfig より先に判定）
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`sap-mcp-server ${VERSION}`);
  process.exit(0);
}

const config = loadConfig();

const server = new Server(
  { name: 'sap-mcp-server', version: VERSION },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: 'sap_list_destinations',
    description: 'BTP サブアカウント上の全 Destination を一覧表示する。Description フィールドから用途（DEV/QAS/PRD など）を識別する用途。',
    inputSchema: {
      type: 'object',
      properties: {
        connection: { type: 'string', description: '接続キー（connections.json の connections のキー）。省略時はデフォルト' },
      },
    },
  },
  {
    name: 'sap_use_destination',
    description: 'セッション中のデフォルト Destination を切り替える。以降の sap_call_fm / sap_select_table は省略時にこれを使う。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'BTP Destination 名' },
        connection:  { type: 'string' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'sap_current_destination',
    description: '現在のセッションデフォルト Destination を確認する。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sap_call_fm',
    description: 'SAP ABAP の Function Module をバックエンドの REST handler 経由で呼び出す。importing には {name, value, abaptype}、tabparams には {name, value=行型名, rows?=入力JSON配列文字列} を渡す。',
    inputSchema: {
      type: 'object',
      properties: {
        fm:        { type: 'string', description: 'FM 名（例: BAPI_USER_GETLIST）' },
        importing: { type: 'array',  items: { type: 'object' }, description: '入力。{name, value, abaptype}' },
        exporting: { type: 'array',  items: { type: 'object' }, description: '出力型ヒント。{name, value=ABAP型名}' },
        tabparams: { type: 'array',  items: { type: 'object' }, description: 'TABLES。{name, value=行型名, rows?=入力JSON}' },
        client:    { type: 'string', description: 'sap-client（マンダント）' },
        commit:    { type: 'boolean', description: 'true で BAPI_TRANSACTION_COMMIT 実行' },
        destination: { type: 'string', description: 'BTP Destination 名（省略時はセッションデフォルト → connection.defaultDestination）' },
        connection:  { type: 'string' },
      },
      required: ['fm'],
    },
  },
  {
    name: 'sap_select_table',
    description: 'SAP テーブルから動的に SELECT する（RFC_READ_TABLE 相当）。ABAP 側は SELECT * を実行し、fields はクライアント側フィルタとして扱われる。',
    inputSchema: {
      type: 'object',
      properties: {
        table:   { type: 'string',  description: 'テーブル名（例: T001, MARA）' },
        fields:  { type: 'array',   items: { type: 'string' }, description: '取得列（クライアント側で絞り込み）' },
        where:   { type: 'array',   items: { type: 'string' }, description: 'WHERE 句（複数行は AND で連結）' },
        maxrows: { type: 'integer', description: '最大行数（既定 1000）' },
        client:  { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['table'],
    },
  },
  {
    name: 'sap_adt_freestyle',
    description: 'ADT REST API 経由で自由 SQL を実行する（/sap/bc/adt/datapreview/freestyle）。パラメータ付き CDS view（例: I_GLAccountLineItemCube( P_DisplayCurrency = \'\' )）も読める。SELECT のみ許可（最大 4000 文字）。',
    inputSchema: {
      type: 'object',
      properties: {
        sql:      { type: 'string',  description: 'SELECT 文。CDS パラメータも記述可（例: SELECT ... FROM I_GLAccountLineItemCube( P_DisplayCurrency = \'\' ) WHERE ...）' },
        rowCount: { type: 'integer', description: '最大行数（既定 100、上限 5000）' },
        client:   { type: 'string',  description: 'sap-client（マンダント）' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'sap_adt_osql',
    description: 'ADT SQL Console 経由で Open SQL を実行する（現状 sap_adt_freestyle と同一エンドポイント。互換用）。',
    inputSchema: {
      type: 'object',
      properties: {
        sql:      { type: 'string',  description: 'SELECT 文' },
        rowCount: { type: 'integer', description: '最大行数（既定 100、上限 5000）' },
        client:   { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'sap_adt_ddic',
    description: 'ADT REST 経由で DDIC オブジェクト（テーブル / CDS view）を SELECT * する。WHERE 不要のクイック確認用。',
    inputSchema: {
      type: 'object',
      properties: {
        ddicName: { type: 'string',  description: 'テーブル名 / CDS view 名（英数字・アンダースコア・スラッシュ 30 文字以内）' },
        rowCount: { type: 'integer', description: '最大行数（既定 100、上限 5000）' },
        client:   { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['ddicName'],
    },
  },
  {
    name: 'sap_call_ias_admin',
    description: 'SAP Cloud Identity Services (IAS) Admin API を呼び出す。SCIM Users / Groups / Applications / Schemas / Tenant Setting 等。登録済みの IAS Destination 名を指定。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'IAS Destination 名' },
        method:      { type: 'string',  description: 'HTTP メソッド（既定 GET）。例: GET / POST / PUT / PATCH / DELETE' },
        path:        { type: 'string',  description: 'リソースパス（例: /scim/Users, /scim/Groups, /Applications/v1）' },
        query:       { type: 'object',  description: 'クエリパラメータ（例: { filter: \'userName eq "foo"\', count: 10 }）' },
        body:        { description: 'リクエストボディ（JSON-able）' },
        headers:     { type: 'object',  description: '追加ヘッダ（Accept: application/scim+json 等）' },
        timeoutMs:   { type: 'integer', description: 'タイムアウト (ms)。既定 60000' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_ips_job',
    description: 'SAP Identity Provisioning Service (IPS) Jobs / JobLogs API を呼び出す。IAS Destination を流用（同一テナント内 /service/scim/Jobs 系）。公式 API は Jobs と JobLogs の 2 リソースのみ。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'IAS Destination 名（IPS は IAS と同居）' },
        method:      { type: 'string',  description: 'HTTP メソッド（既定 GET）' },
        path:        { type: 'string',  description: 'リソースパス（例: /service/scim/Jobs, /service/scim/JobLogs）' },
        query:       { type: 'object' },
        body:        { description: 'リクエストボディ' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_cf_api',
    description: 'Cloud Foundry API v3 を呼び出す。apps / orgs / spaces / service_instances / service_bindings / scale / restart 等。登録済みの CF API Destination 名を指定（OAuth2Password + cf client）。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'CF API Destination 名' },
        method:      { type: 'string',  description: 'HTTP メソッド（既定 GET）。読取は GET、操作は POST/PATCH/DELETE' },
        path:        { type: 'string',  description: 'リソースパス（例: /v3/apps, /v3/organizations, /v3/spaces, /v3/service_instances）' },
        query:       { type: 'object',  description: 'クエリパラメータ（例: { per_page: 100, names: \'app1,app2\' }）' },
        body:        { description: 'リクエストボディ（POST/PATCH 用 JSON）' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_bwz_content',
    description: 'Build Work Zone Standard Content API を呼び出す。tiles / groups / roles / pages / content_packages の取得・upload・publish・delete。登録済みの BWZ Content API Destination 名を指定（OAuth2ClientCredentials）。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'BWZ Content Destination 名' },
        method:      { type: 'string',  description: 'HTTP メソッド（既定 GET）' },
        path:        { type: 'string',  description: 'リソースパス（例: /api/v1/Tiles, /api/v1/Groups, /api/v1/Roles, /api/v1/Pages, /api/v1/ContentPackages）' },
        query:       { type: 'object' },
        body:        { description: 'リクエストボディ' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_ctms_api',
    description: 'SAP Cloud Transport Management v2 API を呼び出す。nodes 一覧 / transportRequests 一覧 / import / queues。登録済みの cTMS Destination 名を指定。クセ: 一覧は nodeId（数値）+ status 必須 + top/skip、インポートは plural transportRequests:[<id>] body。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'cTMS Destination 名' },
        method:      { type: 'string',  description: 'HTTP メソッド（既定 GET）' },
        path:        { type: 'string',  description: 'リソースパス（例: /v2/nodes, /v2/nodes/{nodeId}/transportRequests, /v2/nodes/{nodeId}/transportRequests/import）' },
        query:       { type: 'object',  description: '例: { status: \'P|R|F\', top: 100, skip: 0 }' },
        body:        { description: 'リクエストボディ（import は { transportRequests: [\'<id>\'] }）' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_forms_api',
    description: 'SAP Forms Service by Adobe REST API を呼び出す。フォーム生成・ADS 操作・テンプレート登録。登録済みの ADS Destination 名を指定（OpenAPI 3.1 /v3/api-docs で詳細確認可）。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'Forms Service Destination 名' },
        method:      { type: 'string',  description: 'HTTP メソッド（既定 GET）' },
        path:        { type: 'string',  description: 'リソースパス（例: /v3/api-docs, /v1/forms, /v3/forms/{id}/data）' },
        query:       { type: 'object' },
        body:        { description: 'リクエストボディ（XDP/JSON/PDF）' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_cis_api',
    description: 'SAP Cloud Information Service (CIS Central) を呼び出す。Global Account / Subaccount / Service Plan / Entitlement 等の参照。登録済みの CIS-Central Destination 名を指定（OAuth2ClientCredentials + GA Viewer/Admin ロール必須）。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'CIS Central Destination 名' },
        method:      { type: 'string',  description: 'HTTP メソッド（既定 GET）' },
        path:        { type: 'string',  description: 'リソースパス（例: /accounts/v1/globalAccount, /accounts/v1/subaccounts, /entitlements/v1/assignedQuotas）' },
        query:       { type: 'object' },
        body:        { description: 'リクエストボディ' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_cpi_api',
    description: 'SAP Integration Suite (CPI) Audit / Monitoring API を呼び出す。iFlow / Channel / Logs / MessageProcessingLogs 等。登録済みの CPI Audit Destination 名を指定。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'CPI Audit Destination 名' },
        method:      { type: 'string',  description: 'HTTP メソッド（既定 GET）' },
        path:        { type: 'string',  description: 'リソースパス（例: /api/v1/MessageProcessingLogs, /api/v1/IntegrationPackages, /api/v1/IntegrationRuntimeArtifacts）' },
        query:       { type: 'object',  description: '例: { $filter: "Status eq \'FAILED\'", $top: 100 }' },
        body:        { description: 'リクエストボディ' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_btp_cli',
    description: 'SAP btp CLI を実行する。利用可能なコマンドは SAP 公開リファレンス参照（help.sap.com「Account Administration Using the btp CLI」/ `btp help`）。args に CLI 引数の配列を渡す（例: ["assign","security/role-collection","<RC>","--to-group","<group>","--of-idp","sap.custom","--subaccount","<guid>"]）。login は不要（接続側で自動）。登録済みの btp CLI Destination 名（BasicAuthentication）を指定。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'btp CLI Destination 名（BasicAuthentication）' },
        args:        { type: 'array', items: { type: 'string' }, description: 'CLI 引数の配列（login/--url/--user/--password は不要）' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'args'],
    },
  },
  {
    name: 'sap_call_cf_cli',
    description: 'Cloud Foundry CLI を実行する。利用可能なコマンドは SAP/CF 公開リファレンス参照（cli.cloudfoundry.org / `cf help`）。args に CLI 引数の配列を渡す。api/auth は接続側で自動。登録済みの cf CLI Destination 名を指定。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'cf CLI Destination 名' },
        args:        { type: 'array', items: { type: 'string' }, description: 'CLI 引数の配列（api/auth は不要）' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'args'],
    },
  },
  {
    name: 'sap_call_datasphere_cli',
    description: 'SAP Datasphere CLI を実行する。利用可能なコマンドは SAP 公開リファレンス参照（`datasphere help`）。args に CLI 引数の配列を渡す。login は接続側で自動。登録済みの Datasphere CLI Destination 名を指定。注: ユーザー個人権限(user_scopes/authorization_code)が必須のコマンドは headless 非対応。',
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'Datasphere CLI Destination 名' },
        args:        { type: 'array', items: { type: 'string' }, description: 'CLI 引数の配列（login は不要）' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'args'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

function resolveDestName(args: any, connectionId: string, connectionDefault?: string): string {
  if (args.destination) return args.destination;
  const cur = getCurrentDestination();
  if (cur && cur.connection === connectionId) return cur.destination;
  if (connectionDefault) return connectionDefault;
  throw new Error('destination 未指定。sap_use_destination で設定するか、引数で指定してください。');
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params as any;
  try {
    switch (name) {
      case 'sap_list_destinations': {
        const connection = getConnection(config, args.connection);
        const list       = await listDestinations(connection);
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
      }

      case 'sap_use_destination': {
        const connection = getConnection(config, args.connection);
        setDestination(connection.id, args.destination);
        return { content: [{ type: 'text', text: `デフォルト Destination を ${args.destination} に切り替えました（接続=${connection.id}）` }] };
      }

      case 'sap_current_destination': {
        const cur = getCurrentDestination();
        return { content: [{ type: 'text', text: cur ? `${cur.connection} / ${cur.destination}` : '（未設定）' }] };
      }

      case 'sap_call_fm': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callFm(connection, destName, {
          fm:        args.fm,
          importing: args.importing,
          exporting: args.exporting,
          tabparams: args.tabparams,
          commit:    args.commit,
          client:    args.client,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_select_table': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const rows       = await callSelectTable(connection, destName, {
          table:   args.table,
          fields:  args.fields,
          where:   args.where,
          maxrows: args.maxrows,
          client:  args.client,
        });
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
      }

      case 'sap_adt_freestyle': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callAdtFreestyle(connection, destName, {
          sql:      args.sql,
          client:   args.client,
          rowCount: args.rowCount,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_adt_osql': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callAdtOsql(connection, destName, {
          sql:      args.sql,
          client:   args.client,
          rowCount: args.rowCount,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_adt_ddic': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callAdtDdic(connection, destName, {
          ddicName: args.ddicName,
          client:   args.client,
          rowCount: args.rowCount,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_call_ias_admin': {
        const connection = getConnection(config, args.connection);
        const result = await callIasAdmin(connection, {
          destination: args.destination,
          method:      args.method,
          path:        args.path,
          query:       args.query,
          body:        args.body,
          headers:     args.headers,
          timeoutMs:   args.timeoutMs,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_call_ips_job': {
        const connection = getConnection(config, args.connection);
        const result = await callIpsJob(connection, {
          destination: args.destination,
          method:      args.method,
          path:        args.path,
          query:       args.query,
          body:        args.body,
          headers:     args.headers,
          timeoutMs:   args.timeoutMs,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_call_cf_api': {
        const connection = getConnection(config, args.connection);
        const result = await callCfApi(connection, {
          destination: args.destination,
          method:      args.method,
          path:        args.path,
          query:       args.query,
          body:        args.body,
          headers:     args.headers,
          timeoutMs:   args.timeoutMs,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_call_bwz_content': {
        const connection = getConnection(config, args.connection);
        const result = await callBwzContent(connection, {
          destination: args.destination,
          method:      args.method,
          path:        args.path,
          query:       args.query,
          body:        args.body,
          headers:     args.headers,
          timeoutMs:   args.timeoutMs,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_call_ctms_api': {
        const connection = getConnection(config, args.connection);
        const result = await callCtmsApi(connection, {
          destination: args.destination,
          method:      args.method,
          path:        args.path,
          query:       args.query,
          body:        args.body,
          headers:     args.headers,
          timeoutMs:   args.timeoutMs,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_call_forms_api': {
        const connection = getConnection(config, args.connection);
        const result = await callFormsApi(connection, {
          destination: args.destination,
          method:      args.method,
          path:        args.path,
          query:       args.query,
          body:        args.body,
          headers:     args.headers,
          timeoutMs:   args.timeoutMs,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_call_cis_api': {
        const connection = getConnection(config, args.connection);
        const result = await callCisApi(connection, {
          destination: args.destination,
          method:      args.method,
          path:        args.path,
          query:       args.query,
          body:        args.body,
          headers:     args.headers,
          timeoutMs:   args.timeoutMs,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_call_cpi_api': {
        const connection = getConnection(config, args.connection);
        const result = await callCpiApi(connection, {
          destination: args.destination,
          method:      args.method,
          path:        args.path,
          query:       args.query,
          body:        args.body,
          headers:     args.headers,
          timeoutMs:   args.timeoutMs,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_call_btp_cli':
      case 'sap_call_cf_cli':
      case 'sap_call_datasphere_cli': {
        const connection = getConnection(config, args.connection);
        const service: 'btp' | 'cf' | 'datasphere' = name === 'sap_call_cf_cli' ? 'cf' : (name === 'sap_call_datasphere_cli' ? 'datasphere' : 'btp');
        const result     = await callCli(connection, {
          service,
          destination: args.destination,
          args:        args.args,
          timeoutMs:   args.timeoutMs,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new Error(`未知のツール: ${name}`);
    }
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: 'text', text: `エラー: ${err?.message || String(err)}` }],
    };
  }
});

// top-level await は CJS バンドル不可。async IIFE で包む（SEA 互換）
(async () => {
  await server.connect(new StdioServerTransport());
  console.error('[sap-mcp-server] 起動しました（stdio）');
})().catch((err) => {
  console.error('[sap-mcp-server] 起動失敗:', err);
  process.exit(1);
});
