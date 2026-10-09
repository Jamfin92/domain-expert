import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import type { ClientCall, EntityGraph, Route } from "@psq/schema";
import { extractNode } from "../src/node.js";
import { mergeGraphs } from "../src/merge.js";
import { basePrefixOf, linkCalls, setBasePrefix } from "../src/node/clients.js";

const FIXTURE = resolve(__dirname, "../../../test/fixtures/mini-client-base");

const route = (method: string, path: string): Route => ({
  method, path, file: "Controllers/X.cs", line: 9,
  handler: { type: "X", method: "M", file: "Controllers/X.cs", line: 10 },
});

// Hand-written ground truth: every .NET route sits under /api.
const DOTNET_ROUTES = [
  route("GET", "/api/Widgets"),
  route("POST", "/api/Widgets"),
  route("GET", "/api/Widgets/{id:int}"),
  route("GET", "/api/Health"),
  route("GET", "/api/Orders"),
  route("GET", "/api/Orders/{id}"),
];

function dotnetGraph(routes: Route[]): EntityGraph {
  return {
    kind: "entity", repo: "/repo", provider: "efcore", contextName: null,
    entities: [], relations: [], shapes: [], routes, clientCalls: [],
    components: [], entityRefs: [], warnings: [],
  };
}

describe("client base prefix: reading the fixture", () => {
  const node = extractNode(FIXTURE);
  const byLine = (line: number) => node.clientCalls.find((c) => c.file === "src/widgets.ts" && c.line === line)!;

  it("keeps the literal path and records the declared prefix beside it", () => {
    expect(node.clientCalls.map((c) => [c.method, c.path, basePrefixOf(c) ?? null])).toEqual([
      ["GET", "/widgets", "/api"],
      ["POST", "/widgets", "/api"],
      ["GET", "/widgets/*", "/api"],
      ["GET", "/api/health", null],
      ["GET", "/nothing", "/api"],
      ["GET", "/orders", null],
      ["GET", "/orders/*", null],
    ]);
  });

  it("warns once per distinct unreadable base, and never for a readable one", () => {
    // Only the node-only no-schema notice is besides: this fixture has no DDL.
    expect(node.warnings).toHaveLength(3);
    expect(node.warnings.filter((w) => w.includes("client base"))).toEqual([
      "src/widgets.ts:9: client base `process.env.VITE_API_URL` is not a statically readable path prefix; calls through it may be unmatched",
      "src/widgets.ts:11: client base `process.env.API_URL` is not a statically readable path prefix; calls through it may be unmatched",
    ]);
  });

  it("does not record a call whose template head is unreadable", () => {
    expect(node.clientCalls.some((c) => c.path.includes("ping"))).toBe(false);
    expect(byLine(5).path).toBe("/widgets/*");
  });

  it("matches nothing on its own: this fixture has no node routes", () => {
    expect(node.clientCalls.every((c) => c.matches === null)).toBe(true);
  });
});

describe("client base prefix: matching through mergeGraphs", () => {
  const node = extractNode(FIXTURE);
  const merged = mergeGraphs(dotnetGraph(DOTNET_ROUTES), node, "client");
  const matches = merged.clientCalls.map((c) => c.matches);

  it("matches prefix + path for declared bases, literal paths as before", () => {
    expect(matches).toEqual([
      "GET /api/Widgets",
      "POST /api/Widgets",
      "GET /api/Widgets/{id:int}",
      "GET /api/Health",
      null, // /api/nothing: prefix known, no such route
      null, // env-var base: never guessed, though /api/Orders exists
      null,
    ]);
  });

  it("carries the unreadable-base warnings through the merge", () => {
    expect(merged.warnings.filter((w) => w.includes("calls through it may be unmatched"))).toHaveLength(2);
  });

  it("does not mutate the node graph's calls", () => {
    expect(node.clientCalls.every((c) => c.matches === null)).toBe(true);
  });
});

describe("linkCalls: literal first, prefix second", () => {
  const call = (path: string, prefix?: string): ClientCall => {
    const c: ClientCall = {
      method: "GET", path, file: "a.ts", line: 1, enclosing: null, matches: null, components: [],
    };
    if (prefix !== undefined) setBasePrefix(c, prefix);
    return c;
  };

  it("prefers the literal path over prefix + path", () => {
    const routes = [route("GET", "/x"), route("GET", "/api/x")];
    const [c] = linkCalls(routes, [call("/x", "/api")], []);
    expect(c!.matches).toBe("GET /x");
  });

  it("falls back to prefix + path only when the call declares one", () => {
    const routes = [route("GET", "/api/x")];
    const [withBase, without] = linkCalls(routes, [call("/x", "/api"), call("/x")], []);
    expect(withBase!.matches).toBe("GET /api/x");
    expect(without!.matches).toBeNull();
  });

  it("warns, naming the effective path, when prefix + path is ambiguous", () => {
    const warnings: string[] = [];
    const [c] = linkCalls([route("GET", "/api/a/{x}"), route("GET", "/api/a/{y}")], [call("/a/*", "/api")], warnings, { aspnet: true });
    expect(c!.matches).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("GET /api/a/* could match");
  });
});
