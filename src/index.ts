#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// stdio 前面: コア（tools.ts）を StdioServerTransport で公開する。
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig }                              from './config.js';
import { TOOLS, dispatchTool, createSessionState } from './tools.js';
import { VERSION }                                 from './version.js';

// --version は connections.json 不要で応答する（loadConfig より先に判定）
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`sap-mcp-server ${VERSION}`);
  process.exit(0);
}

const config  = loadConfig();
const session = createSessionState(); // stdio は単一セッション

const server = new Server(
  { name: 'sap-mcp-server', version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params as any;
  return (await dispatchTool(config, session, name, args)) as any;
});

// top-level await は CJS バンドル不可。async IIFE で包む（SEA 互換）
(async () => {
  await server.connect(new StdioServerTransport());
  console.error('[sap-mcp-server] 起動しました（stdio）');
})().catch((err) => {
  console.error('[sap-mcp-server] 起動失敗:', err);
  process.exit(1);
});
