import { describe, expect, it } from "vitest";
import { generateClientMcq, normalize } from "@psq/quiz";
import type { ClientCall, Component, EntityGraph } from "@psq/schema";

/**
 * Phase E (M5c-ii). The guards on `client.busiest`, each on a synthetic graph
 * built to trip exactly one of them.
 *
 * Every negative case is paired with the positive control below it or above
 * it: `emits one question` is what proves an empty result means the guard
 * fired rather than the generator being inert.
 */

function component(name: string, file: string): Component {
  return { key: `${file}#${name}`, name, file, line: 1 };
}

/** `n` calls attributed to `key`, all matched, at increasing lines. */
function calls(key: string, n: number): ClientCall[] {
  return Array.from({ length: n }, (_, i) => ({
    method: "GET",
    path: `/api/thing/${i}`,
    file: key.split("#")[0]!,
    line: i + 1,
    enclosing: "load",
    matches: `GET /api/thing/${i}`,
    components: [key],
  }));
}

function graph(components: Component[], clientCalls: ClientCall[]): EntityGraph {
  return {
    kind: "entity",
    repo: "/repo",
    provider: "fullstack",
    contextName: null,
    entities: [],
    relations: [],
    shapes: [],
    routes: [],
    clientCalls,
    components,
    warnings: [],
  };
}

const FOUR = [
  component("Alpha", "src/a/Alpha.tsx"),
  component("Bravo", "src/b/Bravo.tsx"),
  component("Charlie", "src/c/Charlie.tsx"),
  component("Delta", "src/d/Delta.tsx"),
];

/** Alpha 3, Bravo 2, Charlie 1, Delta 0 — a strictly unique top. */
function healthy(components: Component[] = FOUR): EntityGraph {
  return graph(components, [
    ...calls(components[0]!.key, 3),
    ...calls(components[1]!.key, 2),
    ...calls(components[2]!.key, 1),
  ]);
}

describe("generateClientMcq", () => {
  it("emits one question, graded on a name with the count in the rationale", () => {
    const qs = generateClientMcq(healthy(), 1337);
    expect(qs).toHaveLength(1);
    const q = qs[0]!;
    expect(q.id).toBe("client.busiest");
    expect(q.generator).toBe("most-calls");
    expect(q.section).toBe("client");
    expect(q.kind).toBe("mcq");
    expect(q.gradeMode).toBe("choice");
    expect(q.choices).toHaveLength(4);
    expect(q.choices![q.answerIndex!]).toBe("Alpha");
    expect(q.subjects).toEqual(["Alpha"]);
    // Rule 1's line: the count is evidence, never the graded field.
    expect(q.rationale).toContain("3 API calls");
    expect(q.choices!.every((c) => !/\d/.test(c))).toBe(true);
  });

  it("asks nothing when the top is tied", () => {
    const g = graph(FOUR, [...calls(FOUR[0]!.key, 3), ...calls(FOUR[1]!.key, 3)]);
    expect(generateClientMcq(g, 1337)).toEqual([]);
  });

  it("asks nothing with fewer than four components", () => {
    const three = FOUR.slice(0, 3);
    expect(generateClientMcq(healthy(three), 1337)).toEqual([]);
    // Positive control on the slice: the same call shape with four is fine.
    expect(generateClientMcq(healthy(), 1337)).toHaveLength(1);
  });

  it("asks nothing when no component calls anything", () => {
    expect(generateClientMcq(graph(FOUR, []), 1337)).toEqual([]);
  });

  it("asks nothing when two dotted paths reduce to the same string", () => {
    // Twinned names force the disambiguated branch; the shared versioned
    // directory is the dot `componentLabel` cannot strip, and BOTH labels
    // collapse to "2/card)".
    const colliding = [
      component("Card", "src/a/v1.2/Card.tsx"),
      component("Card", "src/b/v1.2/Card.tsx"),
      component("Bravo", "src/b/Bravo.tsx"),
      component("Charlie", "src/c/Charlie.tsx"),
    ];
    expect(generateClientMcq(healthy(colliding), 1337)).toEqual([]);
    // Positive control: the same four with a dot-free directory do emit.
    const clean = [
      component("Card", "src/a/v12/Card.tsx"),
      component("Card", "src/b/v12/Card.tsx"),
      component("Bravo", "src/b/Bravo.tsx"),
      component("Charlie", "src/c/Charlie.tsx"),
    ];
    expect(generateClientMcq(healthy(clean), 1337)).toHaveLength(1);
  });

  it("still asks when ONE dotted label collapses to something unshared", () => {
    // The counter-case to the one above, and the reason the guard tests the
    // collision rather than the dot: "Card (src/v1.2/Card)" reduces to
    // "2/card)", which no sibling shares, so all four choices stay distinct
    // and the question grades correctly. A no-dot rule dropped this for
    // nothing.
    const oneDotted = [
      component("Card", "src/v1.2/Card.tsx"),
      component("Card", "src/v2/Card.tsx"),
      component("Bravo", "src/b/Bravo.tsx"),
      component("Charlie", "src/c/Charlie.tsx"),
    ];
    const qs = generateClientMcq(healthy(oneDotted), 1337);
    expect(qs).toHaveLength(1);
    const q = qs[0]!;
    expect(new Set(q.choices!.map(normalize)).size).toBe(4);
    expect(q.choices![q.answerIndex!]).toBe("Card (src/v1.2/Card)");
  });

  it("asks nothing when two names differ only in case", () => {
    // `componentLabel` compares names with `===` and `refs.ts:69` admits both
    // spellings, so `Api` and `API` are two unique components and two BARE
    // labels — no dot anywhere. `normalize()` lowercases, so selftest sees one
    // option twice. The invariant is the collision, never the punctuation.
    const cased = [
      component("Api", "src/a/Api.tsx"),
      component("Bravo", "src/b/Bravo.tsx"),
      component("Charlie", "src/c/Charlie.tsx"),
      component("API", "src/d/API.tsx"),
    ];
    const g = healthy(cased);
    // Positive control on the drop: the labels really are what they look like.
    expect(g.components.map((c) => c.name)).toEqual(["Api", "Bravo", "Charlie", "API"]);
    expect(generateClientMcq(g, 1337)).toEqual([]);
  });

  it("asks nothing when the ANSWER would be a single character", () => {
    // `grade.ts:52` reads a one-letter answer as an option letter before the
    // text branch at `:53`, so such a choice can never be selected by text.
    // As the answer it has no substitute.
    const oneCharTop = [
      component("A", "src/a/A.tsx"),
      component("Bravo", "src/b/Bravo.tsx"),
      component("Charlie", "src/c/Charlie.tsx"),
      component("Delta", "src/d/Delta.tsx"),
    ];
    expect(generateClientMcq(healthy(oneCharTop), 1337)).toEqual([]);
  });

  it("drops a one-character DISTRACTOR without dropping the question", () => {
    // A bad distractor costs one option; only a shortfall below the floor
    // costs the question.
    const oneCharDistractor = [
      component("Alpha", "src/a/Alpha.tsx"),
      component("Bravo", "src/b/Bravo.tsx"),
      component("Charlie", "src/c/Charlie.tsx"),
      component("Delta", "src/d/Delta.tsx"),
      component("A", "src/e/A.tsx"),
    ];
    const qs = generateClientMcq(healthy(oneCharDistractor), 1337);
    expect(qs).toHaveLength(1);
    expect(qs[0]!.choices).not.toContain("A");
    expect(qs[0]!.choices![qs[0]!.answerIndex!]).toBe("Alpha");
  });

  it("asks nothing when dropping unselectable distractors empties the pool", () => {
    // Four components, so the `< 4` guard is not what fires; two of the three
    // distractors go, leaving a pool of 1 and a choice list below MIN_CHOICES.
    const mostlyOneChar = [
      component("Alpha", "src/a/Alpha.tsx"),
      component("B", "src/b/B.tsx"),
      component("C", "src/c/C.tsx"),
      component("Delta", "src/d/Delta.tsx"),
    ];
    expect(generateClientMcq(healthy(mostlyOneChar), 1337)).toEqual([]);
  });

  it("is deterministic for a seed and responsive to a change of seed", () => {
    const g = healthy();
    expect(generateClientMcq(g, 1337)).toEqual(generateClientMcq(g, 1337));
    expect(generateClientMcq(g, 1338)).not.toEqual(generateClientMcq(g, 1337));
    // The answer never moves with the seed; only its position does.
    for (const seed of [1337, 1338]) {
      const q = generateClientMcq(g, seed)[0]!;
      expect(q.choices![q.answerIndex!]).toBe("Alpha");
    }
  });
});
