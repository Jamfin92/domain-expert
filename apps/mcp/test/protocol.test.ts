import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Workspace } from "../../server/src/workspace.js";
import { INSTRUCTION } from "../src/brief.js";
import { createServer } from "../src/server.js";
import { tools } from "../src/tools.js";
import { MINI_EFCORE_REFS } from "../../../test/fixtures.js";

const workspace = new Workspace();
afterEach(() => workspace.closeAll());

async function connect(): Promise<Client> {
  const server = createServer({ workspace });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const textOf = (r: unknown): string =>
  ((r as { content: Array<{ type: string; text: string }> }).content[0] as { text: string }).text;

describe("psq MCP server over an in-memory transport", () => {
  it("lists every tool and the brief prompt", async () => {
    const client = await connect();
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual(Object.keys(tools).sort());
    expect(listed.tools.find((t) => t.name === "refs")?.inputSchema.properties).toHaveProperty("entity");
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toEqual(["brief"]);
  });

  it("opens a repo and answers entity and refs calls as JSON", async () => {
    const client = await connect();
    const opened = JSON.parse(textOf(await client.callTool({ name: "open_repo", arguments: { path: MINI_EFCORE_REFS } })));
    expect(opened.entities).toBe(2);

    const refs = JSON.parse(
      textOf(await client.callTool({ name: "refs", arguments: { repo: opened.id, entity: "Course", via: "entityName" } })),
    );
    expect(refs.refs.length).toBeGreaterThan(0);
    expect(refs.refs[0].cite).toMatch(/\.cs:\d+$/);

    const brief = textOf(await client.callTool({ name: "brief", arguments: { repo: opened.id } }));
    expect(brief).toContain("# Domain brief: mini-efcore-refs");
  });

  it("serves the brief as a prompt carrying the citation instruction", async () => {
    const client = await connect();
    const opened = JSON.parse(textOf(await client.callTool({ name: "open_repo", arguments: { path: MINI_EFCORE_REFS } })));
    const prompt = await client.getPrompt({ name: "brief", arguments: { repo: opened.id } });
    const msg = prompt.messages[0]!;
    expect(msg.role).toBe("user");
    expect((msg.content as { text: string }).text).toContain(INSTRUCTION);
  });

  it("reports a failure as an error result, not a protocol crash", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "entity", arguments: { name: "X" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/open_repo/);
    const bad = await client.callTool({ name: "refs", arguments: { entity: "Course", via: "bogus" } });
    expect(bad.isError).toBe(true);
  });
});
