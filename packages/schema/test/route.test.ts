import { describe, it, expect } from "vitest";
import { Route } from "../src/index.js";

describe("Route.handler", () => {
  const base = { method: "GET", path: "/x", file: "a.ts", line: 1 };

  it("is optional, so a route without one (the Express reader's) still parses", () => {
    expect(Route.parse(base)).toEqual(base);
  });

  it("round-trips when present", () => {
    const r = { ...base, handler: { type: "XController", method: "Get", file: "X.cs", line: 4 } };
    expect(Route.parse(r)).toEqual(r);
  });

  it("rejects a handler missing a field", () => {
    expect(() => Route.parse({ ...base, handler: { type: "XController", method: "Get" } })).toThrow();
  });
});
