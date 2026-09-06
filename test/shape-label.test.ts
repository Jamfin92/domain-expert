import { describe, expect, it } from "vitest";
import { extractNode } from "@psq/extract";
import { shapeLabel } from "@psq/quiz";
import type { EntityGraph, Shape } from "@psq/schema";
import { MINI_NODE } from "./fixtures.js";

/**
 * Phase 1b-ii. `shapeLabel` is what the five DS prompt sites interpolate in
 * place of the bare `shape.name`, so that a C#/TS twin pair of one DTO no
 * longer produces two questions with the same prompt and different answers.
 * The label carries `shape.file` because that is what extraction and the
 * question ids already key on (`file:name`), and it is what a learner opens.
 * Uniqueness is exact and case-sensitive: selftest keys on raw prompt text,
 * so `Foo` and `foo` are two prompts already and must stay unlabelled.
 */

function shape(name: string, file: string): Shape {
  return {
    name,
    file,
    module: null,
    kind: "interface",
    fields: [],
    members: [],
    discriminator: null,
    mirrors: null,
    mirrorSource: "inferred",
  };
}

function graph(shapes: Shape[]): EntityGraph {
  return {
    kind: "entity",
    repo: "/repo",
    provider: "fullstack",
    contextName: null,
    entities: [],
    relations: [],
    shapes,
    routes: [],
    clientCalls: [],
    components: [],
    warnings: [],
  };
}

describe("shapeLabel", () => {
  it("returns the bare name when the name is unique in the graph", () => {
    const a = shape("ProductDto", "server/Dtos/ProductDto.cs");
    const g = graph([a, shape("OrderDto", "server/Dtos/OrderDto.cs")]);
    expect(shapeLabel(g, a)).toBe("ProductDto");
    expect(shapeLabel(g, a)).not.toBe("ProductDto (server/Dtos/ProductDto.cs)");
  });

  it("labels both twins with their own file when a name appears twice", () => {
    const cs = shape("ProductDto", "server/Dtos/ProductDto.cs");
    const ts = shape("ProductDto", "client/src/types/product-dto.ts");
    const g = graph([cs, ts]);
    expect(shapeLabel(g, cs)).toBe("ProductDto (server/Dtos/ProductDto.cs)");
    expect(shapeLabel(g, ts)).toBe("ProductDto (client/src/types/product-dto.ts)");
    expect(shapeLabel(g, cs)).not.toBe(shapeLabel(g, ts));
  });

  it("labels all three when a name appears three times, all distinct", () => {
    const one = shape("Dup", "a/one.ts");
    const two = shape("Dup", "b/two.ts");
    const three = shape("Dup", "c/three.cs");
    const g = graph([one, two, three]);
    const labels = [one, two, three].map((s) => shapeLabel(g, s));
    expect(labels).toEqual([
      "Dup (a/one.ts)",
      "Dup (b/two.ts)",
      "Dup (c/three.cs)",
    ]);
    expect(new Set(labels).size).toBe(3);
  });

  it("leaves every shape bare on a real graph whose names are all unique", () => {
    // MINI_NODE extracts 12 shapes, no name repeated. MINI_EFCORE would be a
    // vacuous check: it extracts 0 shapes.
    const g = extractNode(MINI_NODE);
    expect(g.shapes.length).toBeGreaterThanOrEqual(2);
    for (const s of g.shapes) expect(shapeLabel(g, s)).toBe(s.name);
  });

  it("treats case as significant, so Foo and foo are both bare", () => {
    const upper = shape("Foo", "a/foo.ts");
    const lower = shape("foo", "b/foo.ts");
    const g = graph([upper, lower]);
    expect(shapeLabel(g, upper)).toBe("Foo");
    expect(shapeLabel(g, lower)).toBe("foo");
  });
});
