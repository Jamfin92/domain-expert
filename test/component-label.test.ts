import { describe, expect, it } from "vitest";
import { extractNode } from "@psq/extract";
import { componentLabel, normalize } from "@psq/quiz";
import type { Component, EntityGraph } from "@psq/schema";
import { MINI_FULLSTACK_REACT } from "./fixtures.js";

/**
 * Phase E (M5c-ii). The quiz-side label for a UI component, used as MCQ
 * CHOICE text — which is why it drops the file extension and the web copy in
 * `apps/web/src/lib/client-calls.ts` keeps it. See `component-label.ts` for
 * the mechanism; the last case here is the gate on it.
 *
 * Structure mirrors `shape-label.test.ts`: unique, twin, three-way, a real
 * graph, and case sensitivity.
 */

function component(name: string, file: string): Component {
  return { key: `${file}#${name}`, name, file, line: 1 };
}

function graph(components: Component[]): EntityGraph {
  return {
    kind: "entity",
    repo: "/repo",
    provider: "fullstack",
    contextName: null,
    entities: [],
    relations: [],
    shapes: [],
    routes: [],
    clientCalls: [],
    components,
    warnings: [],
  };
}

describe("componentLabel", () => {
  it("returns the bare name when the name is unique in the graph", () => {
    const a = component("Basket", "src/components/shop/Basket.tsx");
    const g = graph([a, component("Header", "src/components/Header.tsx")]);
    expect(componentLabel(g, a)).toBe("Basket");
    expect(componentLabel(g, a)).not.toBe("Basket (src/components/shop/Basket)");
  });

  it("labels both twins with their own file when a name appears twice", () => {
    const admin = component("Card", "src/components/admin/Card.tsx");
    const shop = component("Card", "src/components/shop/Card.tsx");
    const g = graph([admin, shop]);
    expect(componentLabel(g, admin)).toBe("Card (src/components/admin/Card)");
    expect(componentLabel(g, shop)).toBe("Card (src/components/shop/Card)");
    expect(componentLabel(g, admin)).not.toBe(componentLabel(g, shop));
  });

  it("labels all three when a name appears three times, all distinct", () => {
    const one = component("Dup", "a/one.tsx");
    const two = component("Dup", "b/two.tsx");
    const three = component("Dup", "c/three.jsx");
    const g = graph([one, two, three]);
    const labels = [one, two, three].map((c) => componentLabel(g, c));
    expect(labels).toEqual(["Dup (a/one)", "Dup (b/two)", "Dup (c/three)"]);
    expect(new Set(labels).size).toBe(3);
  });

  it("labels every component on a real graph whose four names are two pairs", () => {
    // The hermetic fixture carries exactly two `Card`s and two `Panel`s, so
    // every component here takes the disambiguated branch — the bare branch is
    // covered by the synthetic case above.
    const g = extractNode(MINI_FULLSTACK_REACT);
    expect(g.components.length).toBe(4);
    const labels = g.components.map((c) => componentLabel(g, c));
    expect(labels).toEqual([
      "Card (src/components/admin/Card)",
      "Panel (src/components/admin/Panel)",
      "Card (src/components/shop/Card)",
      "Panel (src/components/shop/Panel)",
    ]);
  });

  it("treats case as significant, so Foo and foo are both bare", () => {
    // Inherited from `shape-label.test.ts`, and the reason there does NOT
    // carry over. `shapeLabel`'s output only reaches prompts, where two
    // case-differing labels are two distinct prompts and nothing more. This
    // label reaches CHOICE text, and `normalize()` lowercases — so these two
    // bare labels are one option to selftest, with no dot anywhere to warn
    // anyone. That is a real hazard on any repo holding both spellings
    // (`refs.ts:69` admits either), and it is caught downstream, by
    // `client-mcq.ts`'s `choicesCollide()` on the final choice list, NOT
    // here. This case pins the labelling rule only; do not read it as a
    // claim that such a pair is safe to ask about.
    const upper = component("Foo", "a/Foo.tsx");
    const lower = component("foo", "b/foo.tsx");
    const g = graph([upper, lower]);
    expect(componentLabel(g, upper)).toBe("Foo");
    expect(componentLabel(g, lower)).toBe("foo");
    // The collision the labels themselves cannot avoid, pinned so the note
    // above is checked rather than merely asserted.
    expect(normalize(componentLabel(g, upper))).toBe(normalize(componentLabel(g, lower)));
  });

  it("survives normalize(), which the web copy's format does not", () => {
    // The reason the two copies differ. With the extension kept, every label
    // collapses to "tsx)" and the MCQ built from them cannot be failed.
    const admin = component("Card", "src/components/admin/Card.tsx");
    const shop = component("Card", "src/components/shop/Card.tsx");
    const g = graph([admin, shop]);
    const quizSide = [admin, shop].map((c) => componentLabel(g, c));
    expect(new Set(quizSide.map(normalize)).size).toBe(2);

    // The web format, spelled out rather than imported: `apps/web` is not a
    // dependency of this package and must not become one.
    const webSide = [admin, shop].map((c) => `${c.name} (${c.file})`);
    expect(webSide.map(normalize)).toEqual(["tsx)", "tsx)"]);
    expect(new Set(webSide.map(normalize)).size).toBe(1);
  });
});
