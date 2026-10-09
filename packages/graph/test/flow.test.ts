import { describe, it, expect } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDotnet } from "@psq/extract";
import type { EntityGraph, Route } from "@psq/schema";
import { flowFor, routeFlow, DEFAULT_FLOW_DEPTH } from "../src/index.js";

/**
 * Expectations were derived by hand from the fixture's source files, following
 * each call in the order of its call site. `Type.method` labels are as an
 * `EntityRef` spells them.
 */
const ROUTES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../test/fixtures/mini-aspnet-routes",
);

const g = extractDotnet(ROUTES);
const route = (method: string, path: string): Route =>
  g.routes.find((r) => r.method === method && r.path === path)!;

const labels = (f: { nodes: Array<{ type: string; method: string }> }): string[] =>
  f.nodes.map((n) => `${n.type}.${n.method}`);

describe("routeFlow on the fixture", () => {
  it("follows a handler through an interface, its one implementation and a repository", () => {
    const f = routeFlow(g, route("GET", "/api/Gadgets/{id}"))!;
    expect(labels(f)).toEqual([
      "GadgetsController.Get",
      "GadgetService.Assemble",
      "IGadgetService.Assemble",
      "GadgetRepository.Load",
      "IGadgetRepository.Load",
      "GadgetService.Rebalance",
      "GadgetService.Settle",
    ]);
    expect(f.nodes.map((n) => n.depth)).toEqual([0, 1, 1, 2, 2, 2, 3]);
    expect(f.nodes[3]!.path).toEqual([
      "GadgetsController.Get", "GadgetService.Assemble", "GadgetRepository.Load",
    ]);
    // the handler itself mentions no entity; the work is two calls down
    expect(f.nodes[0]!.entities).toEqual([]);
    expect(f.nodes[1]!.entities).toEqual(["Gadget"]);
    expect(f.nodes[3]!.entities).toEqual(["Gadget"]);
    expect(f.entities).toEqual(["Gadget"]);
    expect(f.truncated).toBe(false);
    expect(f.nodes.every((n) => !n.ambiguous)).toBe(true);
  });

  it("marks every path through an interface with several implementations ambiguous", () => {
    const f = routeFlow(g, route("PUT", "/api/Gadgets/{id}/retire"))!;
    const by = (m: string, t: string) => f.nodes.find((n) => n.type === t && n.method === m)!;
    expect(by("Send", "EmailNotifier").ambiguous).toBe(true);
    expect(by("Send", "SmsNotifier").ambiguous).toBe(true);
    expect(by("Send", "INotifier").ambiguous).toBe(false);
    expect(by("Remove", "GadgetRepository").ambiguous).toBe(false);
    expect(by("Send", "EmailNotifier").entities).toEqual(["Sprocket"]);
    expect(by("Send", "SmsNotifier").entities).toEqual(["Widget"]);
    expect(f.entities).toEqual(["Gadget", "Sprocket", "Widget"]);
    // Remove -> Load, reached through the repository, three calls down
    expect(by("Load", "GadgetRepository").depth).toBe(3);
  });

  it("carries ambiguity down: what an ambiguous implementation calls is ambiguous too", () => {
    const send = { type: "EmailNotifier", method: "Send", file: "Services/Notifiers.cs", line: 7 };
    const onward = {
      from: send,
      to: { type: "Smtp", method: "Open", file: "Services/Smtp.cs", line: 3 },
      line: 9,
    };
    const extended: EntityGraph = { ...g, calls: [...g.calls!, onward] };
    const f = routeFlow(extended, route("PUT", "/api/Gadgets/{id}/retire"))!;
    const open = f.nodes.find((n) => n.type === "Smtp")!;
    expect(open.depth).toBe(3);
    expect(open.ambiguous).toBe(true);
    // a sibling reached through the unambiguous interface edge stays unambiguous
    expect(f.nodes.find((n) => n.type === "INotifier")!.ambiguous).toBe(false);
  });

  it("reaches a local-typed call", () => {
    const f = routeFlow(g, route("GET", "/api/Gadgets/calc"))!;
    expect(labels(f)).toEqual(["GadgetsController.Calc", "Calculator.Add"]);
    expect(f.entities).toEqual(["Widget"]);
  });

  it("stops at the depth cap and says so; the unreached entity is not claimed", () => {
    const r = route("GET", "/api/Gadgets/deep");
    expect(DEFAULT_FLOW_DEPTH).toBe(4);
    const capped = routeFlow(g, r)!;
    expect(labels(capped)).toEqual([
      "GadgetsController.Deep", "Chain.Step0", "Chain.Step1", "Chain.Step2", "Chain.Step3",
    ]);
    expect(capped.truncated).toBe(true);
    expect(capped.entities).toEqual([]); // Part lives in Step5, six calls down
    expect(routeFlow(g, r, { maxDepth: 2 })!.nodes).toHaveLength(3);

    const full = routeFlow(g, r, { maxDepth: 6 })!;
    expect(full.nodes.at(-1)).toMatchObject({ type: "Chain", method: "Step5", depth: 6 });
    expect(full.entities).toEqual(["Part"]);
    expect(full.truncated).toBe(false);
  });

  it("reports an opaque handler as itself plus how many calls it could not follow", () => {
    const f = routeFlow(g, route("GET", "/api/Gadgets/{id}/opaque"))!;
    expect(labels(f)).toEqual(["GadgetsController.Opaque"]);
    expect(f.nodes[0]!.unresolvedCalls).toBe(3);
    expect(f.truncated).toBe(false);
  });

  it("returns null for a route with no handler", () => {
    expect(routeFlow(g, { handler: undefined })).toBeNull();
  });
});

describe("flowFor", () => {
  it("survives a cycle: each method once, and a cycle is not truncation", () => {
    const start = { type: "GadgetService", method: "Rebalance" };
    const f = flowFor(g, start);
    expect(labels(f)).toEqual(["GadgetService.Rebalance", "GadgetService.Settle"]);
    const tight = flowFor(g, start, { maxDepth: 1 });
    expect(labels(tight)).toEqual(["GadgetService.Rebalance", "GadgetService.Settle"]);
    expect(tight.truncated).toBe(false);
  });

  it("depth 0 is the start alone, truncated when it calls anything", () => {
    const f = flowFor(g, { type: "GadgetService", method: "Assemble" }, { maxDepth: 0 });
    expect(labels(f)).toEqual(["GadgetService.Assemble"]);
    expect(f.truncated).toBe(true);
    expect(f.entities).toEqual(["Gadget"]);
  });

  it("narrows the start by file, and a file that matches nothing starts from nothing", () => {
    const start = { type: "GadgetService", method: "Assemble" };
    expect(flowFor(g, { ...start, file: "Services/GadgetService.cs" }).nodes).toHaveLength(5);
    const none = flowFor(g, { ...start, file: "Nowhere.cs" });
    expect(labels(none)).toEqual(["GadgetService.Assemble"]);
    expect(none.entities).toEqual([]);
  });

  it("is order-independent over the input and does not mutate the graph", () => {
    const calls = [...g.calls!];
    const shuffled: EntityGraph = { ...g, calls: [...calls].reverse() };
    const a = flowFor(g, { type: "GadgetsController", method: "Retire" });
    expect(flowFor(shuffled, { type: "GadgetsController", method: "Retire" })).toEqual(a);
    expect(g.calls).toEqual(calls);
  });

  it("reads a graph with no call data as the start alone", () => {
    const bare: EntityGraph = { ...g, calls: undefined, unresolvedCalls: undefined };
    const f = flowFor(bare, { type: "GadgetsController", method: "Get" });
    expect(labels(f)).toEqual(["GadgetsController.Get"]);
    expect(f.truncated).toBe(false);
  });
});
