import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractNode } from "../src/index.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../test/fixtures/mini-node-handlers",
);

describe("Route.handler for express routes", () => {
  const g = extractNode(FIXTURE);
  const by = new Map(g.routes.map((r) => [`${r.method} ${r.path}`, r]));
  const handlerOf = (key: string) => by.get(key)?.handler;

  it("reads every registration and warns about none", () => {
    expect(g.routes).toHaveLength(10);
    expect(g.warnings.filter((w) => !/No CREATE TABLE/.test(w))).toEqual([]);
  });

  it("puts an inline arrow at the route's own file:line", () => {
    expect(handlerOf("GET /inline")).toEqual({
      type: "server", method: "<inline>", file: "server.ts", line: 13,
    });
  });

  it("treats the last argument as the handler, behind middleware", () => {
    expect(handlerOf("DELETE /fn-expr")).toEqual({
      type: "server", method: "<inline>", file: "server.ts", line: 24,
    });
    expect(handlerOf("GET /crews/:id")).toEqual({
      type: "handlers", method: "showCrew", file: "handlers.ts", line: 5,
    });
  });

  it("follows an imported function to its declaration", () => {
    expect(handlerOf("GET /crews")).toEqual({
      type: "handlers", method: "listCrews", file: "handlers.ts", line: 1,
    });
  });

  it("follows controller.method to the class method", () => {
    expect(handlerOf("POST /voyages")).toEqual({
      type: "VoyageController", method: "create", file: "handlers.ts", line: 10,
    });
  });

  it("names an object-literal member by the variable holding it", () => {
    expect(handlerOf("GET /ping")).toEqual({
      type: "legacy", method: "ping", file: "handlers.ts", line: 16,
    });
  });

  it("leaves a wrapper call, .bind, an unresolved name and a bare path unhandled", () => {
    for (const k of ["GET /wrapped", "GET /bound", "GET /missing", "GET /only-middleware"]) {
      expect(by.has(k), k).toBe(true);
      expect(by.get(k)!.handler, k).toBeUndefined();
    }
  });
});
