// SPDX-License-Identifier: Apache-2.0
//
// sap-mcp-server — clean-room community edition (scaffold entrypoint)
//
// ⚠️ This is a clean-room scaffold. Implement the MCP server here from scratch.
//
import { VERSION } from "./version.js";

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  // TODO: MCP server (stdio transport) をここで起動する。
  process.stderr.write(
    `sap-mcp-server ${VERSION} — clean-room scaffold. Implementation pending.\n`,
  );
}

main();
