#!/usr/bin/env tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Workspace } from "../../server/src/workspace.js";
import { createServer } from "./server.js";
import type { Ctx } from "./tools.js";

/**
 * `psq-mcp [--repo <path>]` — a stdio MCP server. stdout is the protocol, so
 * everything human-readable goes to stderr.
 */
function repoFlag(argv: string[]): string | undefined {
  const i = argv.indexOf("--repo");
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--repo needs a path");
  }
  return value;
}

async function main(): Promise<void> {
  const ctx: Ctx = { workspace: new Workspace(undefined, { log: (l) => console.error(l) }) };
  const repo = repoFlag(process.argv.slice(2));
  if (repo !== undefined) {
    const opened = ctx.workspace.open(repo);
    console.error(`psq-mcp: opened ${opened.id} (${opened.graph.entities.length} entities)`);
  }
  const server = createServer(ctx);
  process.on("SIGTERM", () => {
    ctx.workspace.closeAll();
    process.exit(0);
  });
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(`psq-mcp: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
