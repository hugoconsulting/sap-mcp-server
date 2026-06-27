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
import {
  callFm, callSelectTable, callAdtFreestyle, callAdtOsql, callAdtDdic,
  callAdtReadSource, callAdtWriteSource, callAdtActivate, callAdtDeleteSource,
  callAdtWriteFm, callCreateTransport, callReleaseTransport,
} from './abap.js';
import {
  callIasAdmin, callIpsJob, callCfApi, callBwzContent, callCtmsApi,
  callFormsApi, callCisApi, callCpiApi, callAnsApi, callCli,
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
    description: 'List all Destinations in the BTP subaccount. Useful for identifying usage (DEV/QAS/PRD, etc.) from the Description field.',
    inputSchema: {
      type: 'object',
      properties: {
        connection: { type: 'string', description: 'Connection key (a key under connections in connections.json). Defaults to the default connection when omitted.' },
      },
    },
  },
  {
    name: 'sap_use_destination',
    description: 'Switch the default Destination for the session. Subsequent sap_call_fm / sap_select_table use it when destination is omitted.',
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
    description: 'Show the current session-default Destination.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sap_call_fm',
    description: 'Call an SAP ABAP Function Module via the backend REST handler. Pass {name, value, abaptype} in importing, and {name, value=row type name, rows?=input JSON array string} in tabparams.',
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
    description: 'Dynamically SELECT from an SAP table (equivalent to RFC_READ_TABLE). The ABAP side runs SELECT *, and fields is applied as a client-side filter.',
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
    description: 'Run free-form SQL via the ADT REST API (/sap/bc/adt/datapreview/freestyle). Can read parameterized CDS views (e.g. I_GLAccountLineItemCube( P_DisplayCurrency = \'\' )). SELECT only (max 4000 chars).',
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
    description: 'Run Open SQL via the ADT SQL Console (currently the same endpoint as sap_adt_freestyle; kept for compatibility).',
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
    description: 'SELECT * a DDIC object (table / CDS view) via ADT REST. Quick inspection without a WHERE clause.',
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
    description: 'Read ABAP source via ADT REST. objectType "program" reads a report/program; "fm" reads a function module (group required). Read-only (mcp_readonly allowed for DEV/QAS).',
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
    description: 'Create or update an ABAP report/program and (by default) activate it, via ADT REST. Writes require the full mcp scope, a DEV-role Destination, and a custom name (Z*/Y* or /NS/*). Pass the full source as a plain string. Returns activation messages (syntax/activation errors) so they can be fixed and re-submitted.',
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
    description: 'Delete an ABAP report/program (objectType=program, default) or a CDS DDL source / view (objectType=ddls) via ADT REST. CDS deletion works even for inactive-only (never-activated) views. Full mcp scope + DEV-role Destination + custom name (Z*/Y* or /NS/*) required.',
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
    description: 'Create or update an ABAP function module (SE37) and (by default) activate it, via ADT REST. The function group is auto-created if absent. Pass the source as FUNCTION <name>. ... ENDFUNCTION. WITHOUT the *"-interface comment block (ADT rejects parameter comment blocks on source PUT; parameters are managed as object metadata — currently only parameterless/body-only modules are supported). Full mcp scope + DEV-role Destination + custom names (Z*/Y* or /NS/*) required.',
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
    description: 'Create a transport request (TR_INSERT_REQUEST_WITH_TASKS). Returns the new transport number (trkorr) to pass to write/delete tools for transportable objects. Full mcp scope + DEV-role Destination required.',
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
    description: 'Release a transport request (TR_RELEASE_REQUEST, headless). Use simulation=true to check without releasing. Releasing exports the request toward its target system. Full mcp scope + DEV-role Destination required.',
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
    description: 'Activate an ABAP object via ADT REST and return activation/syntax messages. Full mcp scope + DEV-role Destination required.',
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
    description: 'Call the SAP Cloud Identity Services (IAS) Admin API. SCIM Users / Groups / Applications / Schemas / Tenant Setting, etc. Specify a registered IAS Destination name.',
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
    description: 'Call the SAP Identity Provisioning Service (IPS) Jobs / JobLogs API. Reuses the IAS Destination (same tenant, /service/scim/Jobs family). The public API exposes only the Jobs and JobLogs resources.',
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
    description: 'Call the Cloud Foundry API v3. apps / orgs / spaces / service_instances / service_bindings / scale / restart, etc. Specify a registered CF API Destination name (OAuth2Password + cf client).',
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
    description: 'Call the Build Work Zone Standard Content API. Get/upload/publish/delete tiles / groups / roles / pages / content_packages. Specify a registered BWZ Content API Destination name (OAuth2ClientCredentials).',
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
    description: 'Call the SAP Cloud Transport Management v2 API. List nodes / list transportRequests / import / queues. Specify a registered cTMS Destination name. Quirks: listing requires nodeId (numeric) + status + top/skip; import uses a plural transportRequests:[<id>] body.',
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
    description: 'Call the SAP Forms Service by Adobe REST API. Form generation, ADS operations, template registration. Specify a registered ADS Destination name (details available via OpenAPI 3.1 at /v3/api-docs).',
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
    description: 'Call the SAP Cloud Information Service (CIS Central). Read Global Account / Subaccount / Service Plan / Entitlement, etc. Specify a registered CIS-Central Destination name (OAuth2ClientCredentials + GA Viewer/Admin role required).',
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
    description: 'Call the SAP Integration Suite (CPI) Audit / Monitoring API. iFlow / Channel / Logs / MessageProcessingLogs, etc. Specify a registered CPI Audit Destination name.',
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
    name: 'sap_call_ans_api',
    description: 'Call the SAP Alert Notification Service REST API (full CRUD across all APIs). Configuration Management API: /cf/configuration/v1/condition | /action | /subscription (GET list / GET by name / POST / PUT / DELETE). Consumer API: /cf/consumer/v1/matched-events | /undelivered-events (GET). Producer API: /cf/producer/v1/resource-events (POST). Specify a registered ANS Destination name (OAuth2ClientCredentials).',
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
    name: 'sap_call_btp_cli',
    description: 'Run the SAP btp CLI. See the SAP public reference for available commands (help.sap.com "Account Administration Using the btp CLI" / `btp help`). Pass CLI arguments as an array in args (e.g. ["assign","security/role-collection","<RC>","--to-group","<group>","--of-idp","sap.custom","--subaccount","<guid>"]). No login needed (handled by the connection). Specify a registered btp CLI Destination name (BasicAuthentication).',
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
    description: 'Run the Cloud Foundry CLI. See the SAP/CF public reference for available commands (cli.cloudfoundry.org / `cf help`). Pass CLI arguments as an array in args. api/auth are handled by the connection. Specify a registered cf CLI Destination name.',
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
    description: 'Run the SAP Datasphere CLI. See the SAP public reference for available commands (`datasphere help`). Pass CLI arguments as an array in args. Login is handled by the connection. Specify a registered Datasphere CLI Destination name. Note: commands that require individual user permissions (user_scopes/authorization_code) are not supported in headless mode.',
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
