import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Workspace } from "../../server/src/workspace.js";
import { renderBrief } from "./brief.js";
import { resolveRepo, tools, type Ctx } from "./tools.js";

export const SERVER_NAME = "psq";

/** Tool output: strings (mermaid, brief) as-is, everything else as compact JSON. */
const asText = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

export function createServer(ctx: Ctx = { workspace: new Workspace() }): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: "0.1.0" });

  for (const [name, t] of Object.entries(tools)) {
    server.registerTool(
      name,
      { description: t.description, inputSchema: t.shape, annotations: { readOnlyHint: true } },
      async (args: Record<string, unknown>) => {
        try {
          const result = (t.run as (c: Ctx, a: unknown) => unknown)(ctx, args);
          return { content: [{ type: "text" as const, text: asText(result) }] };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
          };
        }
      },
    );
  }

  server.registerPrompt(
    "brief",
    {
      description: "A graph-grounded domain brief to start a discussion about the app.",
      argsSchema: { repo: z.string().optional().describe("Repo id from open_repo, or a path") },
    },
    ({ repo }) => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: renderBrief(ctx.workspace, resolveRepo(ctx, repo)) },
        },
      ],
    }),
  );

  return server;
}
