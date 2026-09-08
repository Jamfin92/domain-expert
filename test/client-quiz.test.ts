import { describe, expect, it } from "vitest";
import { extractNode } from "@psq/extract";
import { buildBank, materialize, selftest } from "@psq/quiz";
import { MINI_FULLSTACK_REACT } from "./fixtures.js";

/**
 * Phase E (M5c-ii). The hermetic gate on the client generator, asked through
 * `buildBank` on purpose.
 *
 * `buildBank` is the single composition point (CLAUDE.md): the CLI and the
 * server both call it, and a generator registered anywhere else makes the two
 * shells disagree about what psq asks. Calling `generateClientMcq` directly
 * here would test the function and prove nothing about the bank — removing the
 * `bank.ts` registration would leave such a test green. This case is the only
 * thing in the suite that fails when the registration goes.
 *
 * The corpus repo that also exercises this generator is gitignored, so on a
 * machine without it — and under the standing `PSQ_NO_CORPUS=1` gate — this
 * file is the generator's entire coverage.
 */

const g = extractNode(MINI_FULLSTACK_REACT);
const seeded = materialize(g, { seed: 1337 });
const bank = buildBank(g, seeded, 1337);
const client = bank.filter((q) => q.id === "client.busiest");

describe("the client generator, through the bank", () => {
  it("is composed into buildBank, not merely exported", () => {
    // Positive control on the filter: an empty bank would satisfy a bare
    // `every()` below, so assert the bank is non-empty first.
    expect(bank.length).toBeGreaterThan(0);
    expect(client).toHaveLength(1);
    expect(client[0]!.generator).toBe("most-calls");
    expect(client[0]!.section).toBe("client");
  });

  it("names the busiest component, disambiguated by an extension-free file", () => {
    const q = client[0]!;
    // admin/Panel makes 3 calls; admin/Card and shop/Card make 2 each and
    // shop/Panel 1, so the top is strictly unique. Both names are twinned, so
    // every choice takes the disambiguated branch.
    expect(q.choices).toHaveLength(4);
    expect(q.choices![q.answerIndex!]).toBe("Panel (src/components/admin/Panel)");
    expect([...q.choices!].sort()).toEqual([
      "Card (src/components/admin/Card)",
      "Card (src/components/shop/Card)",
      "Panel (src/components/admin/Panel)",
      "Panel (src/components/shop/Panel)",
    ]);
    // The subject is the bare name, as every other generator does.
    expect(q.subjects).toEqual(["Panel"]);
    expect(q.rationale).toBe(
      "Panel (src/components/admin/Panel) makes 3 API calls; the next highest is " +
        "Card (src/components/admin/Card) with 2.",
    );
    // No choice carries the count: the graded field is a name (rule 1).
    expect(q.choices!.every((c) => !/\d/.test(c))).toBe(true);
  });

  it("keeps the whole hermetic bank both answerable and failable", () => {
    // Rule 5, over the bank this fixture actually produces. The client
    // question is a member of the set being selftested, which is what makes
    // an extension-bearing label a failing gate rather than a style note.
    expect(selftest(bank, { db: seeded.db })).toEqual([]);
    expect(bank.some((q) => q.id === "client.busiest")).toBe(true);
  });

  it("is section-filterable, so a client-only quiz can be served", () => {
    const only = buildBank(g, seeded, 1337, ["client"]);
    expect(only).toHaveLength(1);
    expect(only[0]!.id).toBe("client.busiest");
    // Positive control: the filter excludes rather than the bank being all
    // client questions.
    expect(bank.length).toBeGreaterThan(only.length);
  });
});
