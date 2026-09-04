import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component, ClientCall, Entity, EntityGraph, Shape } from "@psq/schema";
import { mergeGraphs, nodeRootFor } from "../src/merge.js";

// Imported directly rather than through `../src/index.js`: `merge` is an
// internal of `extract()`, and widening the package's public surface for a
// test would make it one. `dotnet.test.ts:2` does the same.

function graph(over: Partial<EntityGraph>): EntityGraph {
  return {
    kind: "entity",
    repo: "/repo",
    provider: "efcore",
    contextName: null,
    entities: [],
    relations: [],
    shapes: [],
    routes: [],
    clientCalls: [],
    components: [],
    warnings: [],
    ...over,
  };
}

function entity(name: string, file: string): Entity {
  return {
    name, namespace: null, file, tableName: name, dbSetName: null,
    keys: ["Id"],
    properties: [{
      name: "Id", type: "int", baseType: "int", nullable: false,
      isPrimaryKey: true, isForeignKey: false, isNavigation: false,
      isCollection: false, column: "Id",
    }],
    indexes: [], isFramework: false,
  };
}

function shape(name: string, file: string, mirrors: string | null = null): Shape {
  return {
    name, file, module: null, kind: "interface",
    fields: [{ name: "id", type: "number", baseType: "number", optional: false, isCollection: false }],
    members: [], discriminator: null, mirrors, mirrorSource: "inferred",
  };
}

function component(name: string, file: string): Component {
  return { key: `${file}#${name}`, name, file, line: 1 };
}

function call(file: string, components: string[]): ClientCall {
  return {
    method: "GET", path: "/api/x", file, line: 3,
    enclosing: null, matches: null, components,
  };
}

const NO_SCHEMA =
  "No CREATE TABLE statement was found, so this repo has shapes but no schema. " +
  "psq reads a schema from raw DDL only; an ORM-defined schema is not read.";

describe("mergeGraphs: re-prefixing node-side paths", () => {
  const node = graph({
    provider: "sqlite-ddl",
    entities: [entity("audit", "db/schema.sql")],
    shapes: [shape("Widget", "src/types.ts")],
    routes: [{ method: "GET", path: "/api/x", file: "src/server.ts", line: 2 }],
    components: [component("Panel", "src/Panel.tsx")],
    clientCalls: [call("src/api.ts", ["src/Panel.tsx#Panel"])],
  });

  const merged = mergeGraphs(graph({ contextName: "Ctx" }), node, "client");

  it("moves every path-bearing field into the merge root", () => {
    // The exhaustive list. Miss one and a DefKey stops resolving, which is
    // silent: the graph still validates and the counts still match.
    expect(merged.entities.map((e) => e.file)).toEqual(["client/db/schema.sql"]);
    expect(merged.shapes.map((s) => s.file)).toEqual(["client/src/types.ts"]);
    expect(merged.routes.map((r) => r.file)).toEqual(["client/src/server.ts"]);
    expect(merged.clientCalls.map((c) => c.file)).toEqual(["client/src/api.ts"]);
    expect(merged.components.map((c) => c.file)).toEqual(["client/src/Panel.tsx"]);
    // The key embeds the path, so it moves too — separately from `file`.
    expect(merged.components.map((c) => c.key)).toEqual([
      "client/src/Panel.tsx#Panel",
    ]);
    expect(merged.clientCalls[0]!.components).toEqual([
      "client/src/Panel.tsx#Panel",
    ]);
  });

  it("leaves every ClientCall.components DefKey resolvable", () => {
    // The failure this catches: prefixing `Component.key` but not the strings
    // inside `ClientCall.components` (or the reverse). Both lists still look
    // right on their own; only the join between them breaks.
    const keys = new Set(merged.components.map((c) => c.key));
    for (const c of merged.clientCalls) {
      for (const k of c.components) expect(keys.has(k)).toBe(true);
    }
    expect(merged.clientCalls.flatMap((c) => c.components).length).toBeGreaterThan(0);
  });

  it("is a no-op on paths when the two roots are the same directory", () => {
    const same = mergeGraphs(graph({}), node, "");
    expect(same.components.map((c) => c.key)).toEqual(["src/Panel.tsx#Panel"]);
    expect(same.clientCalls[0]!.components).toEqual(["src/Panel.tsx#Panel"]);
  });

  it("does not mutate either input", () => {
    expect(node.components[0]!.key).toBe("src/Panel.tsx#Panel");
    expect(node.clientCalls[0]!.components).toEqual(["src/Panel.tsx#Panel"]);
    expect(node.shapes[0]!.file).toBe("src/types.ts");
  });

  it("takes provider, repo and contextName from the merge, not the node side", () => {
    expect(merged.provider).toBe("fullstack");
    expect(merged.contextName).toBe("Ctx");
    expect(merged.repo).toBe("/repo");
  });
});

describe("mergeGraphs: shapes are concatenated, never deduped by name", () => {
  // The two readers sort with DIFFERENT comparators (node is name-then-file,
  // dotnet is name only), so a plain concat is not sorted.
  const dotnet = graph({
    shapes: [shape("CustomerDto", "Dtos/Customer.cs"), shape("OrderDto", "Dtos/Order.cs")],
  });
  const node = graph({
    provider: "sqlite-ddl",
    shapes: [shape("CustomerDto", "types/customer.ts"), shape("Banner", "types/banner.ts")],
  });
  const merged = mergeGraphs(dotnet, node, "web");

  it("keeps every twin, with the EXACT duplicate-name count", () => {
    // Asserted as an exact number on purpose: a merge that deduped by name
    // would leave three shapes and one CustomerDto, and a "at least 3 shapes"
    // check would pass anyway.
    expect(merged.shapes).toHaveLength(4);
    const byName = new Map<string, number>();
    for (const s of merged.shapes) byName.set(s.name, (byName.get(s.name) ?? 0) + 1);
    expect(byName.get("CustomerDto")).toBe(2);
    expect([...byName.values()].filter((n) => n > 1)).toEqual([2]);
  });

  it("keys the twins apart by file, which is unique", () => {
    const keys = merged.shapes.map((s) => `${s.file}#${s.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("Dtos/Customer.cs#CustomerDto");
    expect(keys).toContain("web/types/customer.ts#CustomerDto");
  });

  it("re-sorts by name then file across both sides", () => {
    expect(merged.shapes.map((s) => `${s.name}@${s.file}`)).toEqual([
      "Banner@web/types/banner.ts",
      "CustomerDto@Dtos/Customer.cs",
      "CustomerDto@web/types/customer.ts",
      "OrderDto@Dtos/Order.cs",
    ]);
  });
});

describe("mergeGraphs: warnings", () => {
  it("rewrites the node reader's schema warning when the merge has a schema", () => {
    // The false fact this exists to stop: on EVERY full-stack repo the node
    // side has no DDL and some shapes, so this warning always fires — and
    // `psq graph` prints it beside eight entities it does have.
    const merged = mergeGraphs(
      graph({ entities: [entity("Product", "Models/Product.cs")] }),
      graph({ provider: "sqlite-ddl", shapes: [shape("W", "t.ts")], warnings: [NO_SCHEMA] }),
      "client",
    );
    expect(merged.warnings.some((w) => w === NO_SCHEMA)).toBe(false);
    expect(merged.warnings[0]).toMatch(/schema comes from the \.NET entity model instead/);
  });

  it("leaves it verbatim when the merged graph really has no schema", () => {
    // Rewriting unconditionally would state the opposite wrong fact.
    const merged = mergeGraphs(
      graph({}),
      graph({ provider: "sqlite-ddl", shapes: [shape("W", "t.ts")], warnings: [NO_SCHEMA] }),
      "client",
    );
    expect(merged.warnings).toContain(NO_SCHEMA);
  });

  it("warns when BOTH stacks contribute entities", () => {
    // Unreachable from any fixture and from any repo psq has been pointed at,
    // reachable from literals. `invariants()` cannot see this: it catches a
    // name COLLISION, and `Customer` beside `customers` does not collide.
    const merged = mergeGraphs(
      graph({ entities: [entity("Customer", "Models/Customer.cs")] }),
      graph({ provider: "sqlite-ddl", entities: [entity("customers", "db/schema.sql")] }),
      "api",
    );
    expect(merged.warnings.filter((w) => /both stacks contributed entities/.test(w))).toEqual([
      "both stacks contributed entities (1 from the .NET side, 1 from raw DDL); this graph " +
        "holds two entity languages at once, so any fact that reads a property type without " +
        "knowing which side it came from is unreliable here.",
    ]);
  });

  it("stays silent about two entity languages when only one side has entities", () => {
    const merged = mergeGraphs(
      graph({ entities: [entity("Customer", "Models/Customer.cs")] }),
      graph({ provider: "sqlite-ddl" }),
      "web",
    );
    expect(merged.warnings.some((w) => /both stacks contributed/.test(w))).toBe(false);
  });

  it("says ONCE that TS shapes were never paired against the .NET model", () => {
    // `mirrors` is frozen inside each reader against that run's own entities.
    // A TS shape's `mirrors: null` therefore means "not computed", and nothing
    // in the graph distinguishes that from "no mirror".
    const merged = mergeGraphs(
      graph({ entities: [entity("Product", "Models/Product.cs")] }),
      graph({
        provider: "sqlite-ddl",
        shapes: [shape("A", "a.ts"), shape("B", "b.ts"), shape("C", "c.ts", "Something")],
      }),
      "client",
    );
    const unpaired = merged.warnings.filter((w) => /were not paired against/.test(w));
    expect(unpaired).toHaveLength(1);
    expect(unpaired[0]).toMatch(/^2 shapes from the TypeScript side/);
  });

  it("keeps both readers' own warnings, in a fixed order", () => {
    const merged = mergeGraphs(
      graph({ warnings: ["dotnet said this"] }),
      graph({ provider: "sqlite-ddl", warnings: ["node said this"] }),
      "client",
      ["root selection said this"],
    );
    expect(merged.warnings).toEqual([
      "dotnet said this",
      "node said this",
      "root selection said this",
    ]);
  });
});

describe("nodeRootFor", () => {
  const roots: string[] = [];
  function tmp(dirs: string[], rootConfig = false): string {
    const root = mkdtempSync(join(tmpdir(), "psq-merge-"));
    roots.push(root);
    if (rootConfig) writeFileSync(join(root, "tsconfig.json"), "{}");
    for (const d of dirs) {
      mkdirSync(join(root, d), { recursive: true });
      writeFileSync(join(root, d, "tsconfig.json"), "{}");
    }
    return root;
  }
  function cleanup(): void {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  }

  it("prefers the root's own tsconfig over anything below it", () => {
    const root = tmp(["client"], true);
    expect(nodeRootFor(root)).toEqual({ root, warnings: [] });
    cleanup();
  });

  it("descends to the single candidate, silently — nothing was lost", () => {
    const root = tmp(["client"]);
    expect(nodeRootFor(root)).toEqual({ root: join(root, "client"), warnings: [] });
    cleanup();
  });

  it("refuses to choose between candidates, and says which they were", () => {
    // Rule 3. A guess here silently changes which half of the repo resolves.
    const root = tmp(["admin", "client"]);
    const picked = nodeRootFor(root);
    expect(picked.root).toBe(root);
    expect(picked.warnings).toEqual([
      "no tsconfig.json at the repo root and 2 candidates below it (admin/, client/); " +
        "read the TypeScript side from the root with default compiler options, so " +
        "client-call attribution may be incomplete.",
    ]);
    cleanup();
  });

  it("stays silent with no candidate at all", () => {
    // A tsconfig-less Node repo reads correctly from its root today; warning
    // would make every one of them noisy for nothing.
    const root = tmp([]);
    mkdirSync(join(root, "src"));
    expect(nodeRootFor(root)).toEqual({ root, warnings: [] });
    cleanup();
  });

  it("ignores a tsconfig inside a directory that never holds repo source", () => {
    const root = tmp(["node_modules/pkg", "client"]);
    expect(nodeRootFor(root).root).toBe(join(root, "client"));
    cleanup();
  });
});
