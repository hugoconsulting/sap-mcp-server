// SPDX-License-Identifier: Apache-2.0
// コア: ツール定義（TOOLS）とディスパッチ（dispatchTool）。transport 非依存。
// stdio 前面（index.ts）と support-edge-server（vendor 同期 bundle）の双方から利用される。
import { getConnection }                           from './config.js';
import type { AppConfig }                          from './config.js';
import { listDestinations }                        from './destinations.js';
import {
  callFm, callSelectTable, callAdtFreestyle, callAdtOsql, callAdtDdic,
  callAdtReadSource, callAdtWriteSource, callAdtActivate, callAdtDeleteSource,
  callAdtWriteFm, callCreateTransport, callReleaseTransport,
} from './abap.js';
import {
  callIasAdmin, callIpsJob, callCfApi, callBwzContent, callCtmsApi,
  callFormsApi, callCisApi, callCpiApi, callAnsApi, callSbpaApi, callCli,
  callDatasphereApi, callCalmApi, callJiraApi, callSmartdbApi, callIbpApi,
} from './btp.js';
import catalog from './toolCatalog.json' with { type: 'json' };

// セッション状態（既定 Destination）。stdio はプロセスに 1 つ、HTTP エッジは Mcp-Session-Id 毎に 1 つ持つ。
export interface SessionState {
  current: { connection: string; destination: string } | null;
}

export function createSessionState(): SessionState {
  return { current: null };
}

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: 'text'; text: string }>;
}

// ツールの説明文は単一正本 toolCatalog.json（aiDescription）から取得（ビルド時にバイナリへ焼込）。
// AI 向け description = summary(何をするか) + aiDescription(技術詳細) を連結。
const TOOL_DESC: Record<string, string> = Object.fromEntries(
  ((catalog as any).tools || []).map((tc: any) => {
    const s = ((tc.summary && (tc.summary.en || tc.summary.ja)) || '').replace(/[.\s]+$/, '');
    const d = tc.aiDescription || '';
    return [tc.id, [s, d].filter(Boolean).join('. ')];
  }),
);
const D = (id: string): string => TOOL_DESC[id] || '';

export const TOOLS = [
  {
    name: 'sap_list_destinations',
    description: D('sap_list_destinations'),
    inputSchema: {
      type: 'object',
      properties: {
        connection: { type: 'string', description: 'Connection key (a key under connections in connections.json). Defaults to the default connection when omitted.' },
      },
    },
  },
  {
    name: 'sap_use_destination',
    description: D('sap_use_destination'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'BTP Destination name' },
        connection:  { type: 'string' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'sap_current_destination',
    description: D('sap_current_destination'),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sap_call_fm',
    description: D('sap_call_fm'),
    inputSchema: {
      type: 'object',
      properties: {
        fm:        { type: 'string', description: 'FM name (e.g. BAPI_USER_GETLIST)' },
        importing: { type: 'array',  items: { type: 'object' }, description: 'Input. {name, value, abaptype}' },
        exporting: { type: 'array',  items: { type: 'object' }, description: 'Output type hints. {name, value=ABAP type name}' },
        tabparams: { type: 'array',  items: { type: 'object' }, description: 'TABLES. {name, value=row type name, rows?=input JSON}' },
        client:    { type: 'string', description: 'sap-client (mandant)' },
        commit:    { type: 'boolean', description: 'When true, runs BAPI_TRANSACTION_COMMIT' },
        destination: { type: 'string', description: 'BTP Destination name (falls back to the session default, then connection.defaultDestination, when omitted)' },
        connection:  { type: 'string' },
      },
      required: ['fm'],
    },
  },
  {
    name: 'sap_select_table',
    description: D('sap_select_table'),
    inputSchema: {
      type: 'object',
      properties: {
        table:   { type: 'string',  description: 'Table name (e.g. T001, MARA)' },
        fields:  { type: 'array',   items: { type: 'string' }, description: 'Columns to return (filtered client-side)' },
        where:   { type: 'array',   items: { type: 'string' }, description: 'WHERE clause (multiple lines are joined with AND)' },
        maxrows: { type: 'integer', description: 'Max rows (default 1000)' },
        client:  { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['table'],
    },
  },
  {
    name: 'sap_adt_freestyle',
    description: D('sap_adt_freestyle'),
    inputSchema: {
      type: 'object',
      properties: {
        sql:      { type: 'string',  description: 'SELECT statement. CDS parameters allowed (e.g. SELECT ... FROM I_GLAccountLineItemCube( P_DisplayCurrency = \'\' ) WHERE ...)' },
        rowCount: { type: 'integer', description: 'Max rows (default 100, max 5000)' },
        client:   { type: 'string',  description: 'sap-client (mandant)' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'sap_adt_osql',
    description: D('sap_adt_osql'),
    inputSchema: {
      type: 'object',
      properties: {
        sql:      { type: 'string',  description: 'SELECT statement' },
        rowCount: { type: 'integer', description: 'Max rows (default 100, max 5000)' },
        client:   { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'sap_adt_ddic',
    description: D('sap_adt_ddic'),
    inputSchema: {
      type: 'object',
      properties: {
        ddicName: { type: 'string',  description: 'Table / CDS view name (alphanumerics, underscore, slash; max 30 chars)' },
        rowCount: { type: 'integer', description: 'Max rows (default 100, max 5000)' },
        client:   { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['ddicName'],
    },
  },
  {
    name: 'sap_abap_read_source',
    description: D('sap_abap_read_source'),
    inputSchema: {
      type: 'object',
      properties: {
        name:       { type: 'string', description: 'Object name (program name, or FM name when objectType=fm)' },
        objectType: { type: 'string', description: '"program" (default) or "fm"' },
        group:      { type: 'string', description: 'Function group name (required when objectType=fm)' },
        client:     { type: 'string' },
        destination:{ type: 'string' },
        connection: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'sap_abap_write_source',
    description: D('sap_abap_write_source'),
    inputSchema: {
      type: 'object',
      properties: {
        name:        { type: 'string',  description: 'Program name (Z*/Y* or /NS/*)' },
        source:      { type: 'string',  description: 'Full ABAP source (plain text)' },
        description: { type: 'string',  description: 'Program title/description' },
        package:     { type: 'string',  description: 'Development package (default $TMP = local, no transport)' },
        transport:   { type: 'string',  description: 'Transport request number (required for transportable packages)' },
        activate:    { type: 'boolean', description: 'Activate after writing (default true)' },
        client:      { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['name', 'source'],
    },
  },
  {
    name: 'sap_abap_delete_source',
    description: D('sap_abap_delete_source'),
    inputSchema: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Object name (Z*/Y* or /NS/*)' },
        objectType:  { type: 'string', enum: ['program', 'ddls'], description: 'program (report/program, default) or ddls (CDS DDL source/view)' },
        transport:   { type: 'string', description: 'Transport request number (for transportable packages)' },
        client:      { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'sap_abap_write_fm',
    description: D('sap_abap_write_fm'),
    inputSchema: {
      type: 'object',
      properties: {
        group:       { type: 'string',  description: 'Function group (Z*/Y* or /NS/*). Created if it does not exist.' },
        name:        { type: 'string',  description: 'Function module name (Z*/Y* or /NS/*)' },
        source:      { type: 'string',  description: 'Full FM source: FUNCTION <name>. *"interface... <body> ENDFUNCTION.' },
        description: { type: 'string' },
        package:     { type: 'string',  description: 'Development package (default $TMP)' },
        transport:   { type: 'string',  description: 'Transport request number (for transportable packages)' },
        activate:    { type: 'boolean', description: 'Activate after writing (default true)' },
        client:      { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['group', 'name', 'source'],
    },
  },
  {
    name: 'sap_create_transport',
    description: D('sap_create_transport'),
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Transport short text' },
        type:        { type: 'string', description: "Request type: 'K' workbench (default), 'W' customizing" },
        target:      { type: 'string', description: 'Target system (defaults to the transport route target)' },
        devclass:    { type: 'string', description: 'Development package (optional)' },
        owner:       { type: 'string', description: 'Owner user (defaults to the connection user)' },
        client:      { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['description'],
    },
  },
  {
    name: 'sap_release_transport',
    description: D('sap_release_transport'),
    inputSchema: {
      type: 'object',
      properties: {
        trkorr:      { type: 'string',  description: 'Transport request number' },
        simulation:  { type: 'boolean', description: 'true to simulate (no actual release/export)' },
        client:      { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['trkorr'],
    },
  },
  {
    name: 'sap_abap_activate',
    description: D('sap_abap_activate'),
    inputSchema: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Object name' },
        type:        { type: 'string', description: 'Object type (default PROG)' },
        client:      { type: 'string' },
        destination: { type: 'string' },
        connection:  { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'sap_call_ias_admin',
    description: D('sap_call_ias_admin'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'IAS Destination name' },
        method:      { type: 'string',  description: 'HTTP method (default GET). e.g. GET / POST / PUT / PATCH / DELETE' },
        path:        { type: 'string',  description: 'Resource path (e.g. /scim/Users, /scim/Groups, /Applications/v1)' },
        query:       { type: 'object',  description: 'Query parameters (e.g. { filter: \'userName eq "foo"\', count: 10 })' },
        body:        { description: 'Request body (JSON-able)' },
        headers:     { type: 'object',  description: 'Extra headers (e.g. Accept: application/scim+json)' },
        timeoutMs:   { type: 'integer', description: 'Timeout (ms). Default 60000' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_ips_job',
    description: D('sap_call_ips_job'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'IAS Destination name (IPS is co-located with IAS)' },
        method:      { type: 'string',  description: 'HTTP method (default GET)' },
        path:        { type: 'string',  description: 'Resource path (e.g. /service/scim/Jobs, /service/scim/JobLogs)' },
        query:       { type: 'object' },
        body:        { description: 'Request body' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_cf_api',
    description: D('sap_call_cf_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'CF API Destination name' },
        method:      { type: 'string',  description: 'HTTP method (default GET). GET to read; POST/PATCH/DELETE to operate' },
        path:        { type: 'string',  description: 'Resource path (e.g. /v3/apps, /v3/organizations, /v3/spaces, /v3/service_instances)' },
        query:       { type: 'object',  description: 'Query parameters (e.g. { per_page: 100, names: \'app1,app2\' })' },
        body:        { description: 'Request body (JSON for POST/PATCH)' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_bwz_content',
    description: D('sap_call_bwz_content'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'BWZ Content Destination name' },
        method:      { type: 'string',  description: 'HTTP method (default GET)' },
        path:        { type: 'string',  description: 'Resource path (e.g. /api/v1/Tiles, /api/v1/Groups, /api/v1/Roles, /api/v1/Pages, /api/v1/ContentPackages)' },
        query:       { type: 'object' },
        body:        { description: 'Request body' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_ctms_api',
    description: D('sap_call_ctms_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'cTMS Destination name' },
        method:      { type: 'string',  description: 'HTTP method (default GET)' },
        path:        { type: 'string',  description: 'Resource path (e.g. /v2/nodes, /v2/nodes/{nodeId}/transportRequests, /v2/nodes/{nodeId}/transportRequests/import)' },
        query:       { type: 'object',  description: 'e.g. { status: \'P|R|F\', top: 100, skip: 0 }' },
        body:        { description: 'Request body (import: { transportRequests: [\'<id>\'] })' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_forms_api',
    description: D('sap_call_forms_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'Forms Service Destination name' },
        method:      { type: 'string',  description: 'HTTP method (default GET)' },
        path:        { type: 'string',  description: 'Resource path (e.g. /v3/api-docs, /v1/forms, /v3/forms/{id}/data)' },
        query:       { type: 'object' },
        body:        { description: 'Request body (XDP/JSON/PDF)' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_cis_api',
    description: D('sap_call_cis_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'CIS Central Destination name' },
        method:      { type: 'string',  description: 'HTTP method (default GET)' },
        path:        { type: 'string',  description: 'Resource path (e.g. /accounts/v1/globalAccount, /accounts/v1/subaccounts, /entitlements/v1/assignedQuotas)' },
        query:       { type: 'object' },
        body:        { description: 'Request body' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_cpi_api',
    description: D('sap_call_cpi_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'CPI Audit Destination name' },
        method:      { type: 'string',  description: 'HTTP method (default GET)' },
        path:        { type: 'string',  description: 'Resource path (e.g. /api/v1/MessageProcessingLogs, /api/v1/IntegrationPackages, /api/v1/IntegrationRuntimeArtifacts)' },
        query:       { type: 'object',  description: 'e.g. { $filter: "Status eq \'FAILED\'", $top: 100 }' },
        body:        { description: 'Request body' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_ibp_api',
    description: D('sap_call_ibp_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'IBP Destination name (e.g. SIC_IBP_PRD)' },
        method:      { type: 'string',  description: 'HTTP method (default GET). GET to read; POST for OData actions/writes' },
        path:        { type: 'string',  description: 'Full OData service path (e.g. /sap/opu/odata/IBP/MASTER_DATA_API_SRV/..., /sap/opu/odata4/ibp/api_stock/srvd_a2x/ibp/api_stock/0001/...)' },
        query:       { type: 'object',  description: 'e.g. { $filter: "...", $top: 100, $format: "json" }' },
        body:        { description: 'Request body' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_ans_api',
    description: D('sap_call_ans_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'ANS Destination name (e.g. SIC_ANS_PRD)' },
        method:      { type: 'string',  description: 'HTTP method (default GET). GET to read; POST/PUT/DELETE to operate' },
        path:        { type: 'string',  description: 'Resource path (e.g. /cf/configuration/v1/condition, /cf/configuration/v1/action, /cf/configuration/v1/subscription, /cf/consumer/v1/matched-events, /cf/producer/v1/resource-events)' },
        query:       { type: 'object',  description: 'Query parameters' },
        body:        { description: 'Request body (JSON for POST/PUT)' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_sbpa_api',
    description: D('sap_call_sbpa_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'SBPA Destination name (e.g. SIC_SBPA_PRD)' },
        method:      { type: 'string',  description: 'HTTP method (default GET). GET to read; POST/PUT/DELETE to operate' },
        path:        { type: 'string',  description: 'Resource path (e.g. /workflow/rest/v1/workflow-definitions, /workflow/rest/v1/task-definitions, /workflow/rest/v1/workflow-instances)' },
        query:       { type: 'object',  description: 'Query parameters' },
        body:        { description: 'Request body (JSON for POST/PUT)' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_datasphere_api',
    description: D('sap_call_datasphere_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'Datasphere Destination name (e.g. HD_DS_DEV)' },
        method:      { type: 'string',  description: 'HTTP method (default GET)' },
        path:        { type: 'string',  description: 'Resource path (e.g. /dwaas-core/api/v1/connections, /scim/v2/Users, /dwaas-core/api/v1/spaces/{spaceId})' },
        query:       { type: 'object',  description: 'Query parameters' },
        body:        { description: 'Request body (JSON for POST/PUT)' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_calm_api',
    description: D('sap_call_calm_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'Cloud ALM Destination name (e.g. SIC_CALM)' },
        method:      { type: 'string',  description: 'HTTP method (default GET). GET to read; POST/PUT/DELETE to operate' },
        path:        { type: 'string',  description: 'Resource path (e.g. /api/calm-projects/v1/projects, /api/calm-tasks/v1/tasks, /api/calm-landscape/v1/businessServices, /api/calm-itsmapi/v1/supportcases/cases/ids). If the Destination URL already ends in /api, drop the leading /api here.' },
        query:       { type: 'object',  description: 'Query parameters' },
        body:        { description: 'Request body (JSON for POST/PUT)' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'app_call_jira_api',
    description: D('app_call_jira_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'JIRA Destination name registered in Apps & Services (e.g. SIC_JIRA_PROTO)' },
        method:      { type: 'string',  description: 'HTTP method (default GET). GET to read; POST/PUT/DELETE to operate (create issue, transition, comment)' },
        path:        { type: 'string',  description: 'Resource path relative to the destination base URL (e.g. /rest/api/2/issue/{key}, /rest/servicedeskapi/request). Do NOT include the base host or /prot prefix.' },
        query:       { type: 'object',  description: 'Query parameters' },
        body:        { description: 'Request body (JSON for POST/PUT)' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'app_call_smartdb_api',
    description: D('app_call_smartdb_api'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'SmartDB Destination name registered in Apps & Services (e.g. SIC_SMARTDB_DEV)' },
        method:      { type: 'string',  description: 'HTTP method (default GET). GET to read; POST/PUT/DELETE to operate (create/update document, execute activity)' },
        path:        { type: 'string',  description: 'Resource path relative to the destination base URL which already ends in /hibiki/rest/3 (e.g. /binders/{binder}, /binders/{binder}/views/{view}/documents). Do NOT include the host or /hibiki/rest/3 prefix.' },
        query:       { type: 'object',  description: 'Query parameters' },
        body:        { description: 'Request body (JSON for POST/PUT)' },
        headers:     { type: 'object' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'path'],
    },
  },
  {
    name: 'sap_call_btp_cli',
    description: D('sap_call_btp_cli'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'btp CLI Destination name (BasicAuthentication)' },
        args:        { type: 'array', items: { type: 'string' }, description: 'Array of CLI arguments (no login/--url/--user/--password needed)' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'args'],
    },
  },
  {
    name: 'sap_call_cf_cli',
    description: D('sap_call_cf_cli'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'cf CLI Destination name' },
        args:        { type: 'array', items: { type: 'string' }, description: 'Array of CLI arguments (no api/auth needed)' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'args'],
    },
  },
  {
    name: 'sap_call_datasphere_cli',
    description: D('sap_call_datasphere_cli'),
    inputSchema: {
      type: 'object',
      properties: {
        destination: { type: 'string',  description: 'Datasphere CLI Destination name' },
        args:        { type: 'array', items: { type: 'string' }, description: 'Array of CLI arguments (no login needed)' },
        timeoutMs:   { type: 'integer' },
        connection:  { type: 'string' },
      },
      required: ['destination', 'args'],
    },
  },
];

export async function dispatchTool(config: AppConfig, session: SessionState, name: string, args: any = {}): Promise<ToolResult> {
  function resolveDestName(args: any, connectionId: string, connectionDefault?: string): string {
    if (args.destination) return args.destination;
    const cur = session.current;
    if (cur && cur.connection === connectionId) return cur.destination;
    if (connectionDefault) return connectionDefault;
    throw new Error('destination 未指定。sap_use_destination で設定するか、引数で指定してください。');
  }
  try {
    switch (name) {
      case 'sap_list_destinations': {
        const connection = getConnection(config, args.connection);
        const list       = await listDestinations(connection);
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
      }

      case 'sap_use_destination': {
        const connection = getConnection(config, args.connection);
        session.current = { connection: connection.id, destination: args.destination };
        return { content: [{ type: 'text', text: `デフォルト Destination を ${args.destination} に切り替えました（接続=${connection.id}）` }] };
      }

      case 'sap_current_destination': {
        const cur = session.current;
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

      case 'sap_abap_read_source': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callAdtReadSource(connection, destName, {
          name:       args.name,
          objectType: args.objectType,
          group:      args.group,
          client:     args.client,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_abap_write_source': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callAdtWriteSource(connection, destName, {
          name:        args.name,
          source:      args.source,
          description: args.description,
          package:     args.package,
          transport:   args.transport,
          activate:    args.activate,
          client:      args.client,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_abap_delete_source': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callAdtDeleteSource(connection, destName, {
          name:       args.name,
          objectType: args.objectType,
          transport:  args.transport,
          client:     args.client,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_abap_write_fm': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callAdtWriteFm(connection, destName, {
          group:       args.group,
          name:        args.name,
          source:      args.source,
          description: args.description,
          package:     args.package,
          transport:   args.transport,
          activate:    args.activate,
          client:      args.client,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_create_transport': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callCreateTransport(connection, destName, {
          description: args.description,
          type:        args.type,
          target:      args.target,
          devclass:    args.devclass,
          owner:       args.owner,
          client:      args.client,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_release_transport': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callReleaseTransport(connection, destName, {
          trkorr:     args.trkorr,
          simulation: args.simulation,
          client:     args.client,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'sap_abap_activate': {
        const connection = getConnection(config, args.connection);
        const destName   = resolveDestName(args, connection.id, connection.defaultDestination);
        const result     = await callAdtActivate(connection, destName, {
          name:   args.name,
          type:   args.type,
          client: args.client,
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

      case 'sap_call_ibp_api': {
        const connection = getConnection(config, args.connection);
        const result = await callIbpApi(connection, {
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

      case 'sap_call_ans_api': {
        const connection = getConnection(config, args.connection);
        const result = await callAnsApi(connection, {
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

      case 'sap_call_sbpa_api': {
        const connection = getConnection(config, args.connection);
        const result = await callSbpaApi(connection, {
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

      case 'sap_call_datasphere_api': {
        const connection = getConnection(config, args.connection);
        const result = await callDatasphereApi(connection, {
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

      case 'sap_call_calm_api': {
        const connection = getConnection(config, args.connection);
        const result = await callCalmApi(connection, {
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

      case 'app_call_jira_api': {
        const connection = getConnection(config, args.connection);
        const result = await callJiraApi(connection, {
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

      case 'app_call_smartdb_api': {
        const connection = getConnection(config, args.connection);
        const result = await callSmartdbApi(connection, {
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
}
