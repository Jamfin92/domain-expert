import { describe, it, expect } from "vitest";
import { extractDotnet } from "@psq/extract";
import { generateEntityMcq } from "../src/generate/entity-mcq.js";
import { grade, referenceAnswer } from "../src/grade.js";
import { selftest } from "../src/selftest.js";
import { selectQuiz } from "../src/select.js";
import { normalize, matches, plural, singular, entityAliases } from "../src/normalize.js";
import { rng } from "../src/rng.js";

import { CORPUS, hasCorpus, MINI_EFCORE } from "../../../test/fixtures.js";

const PP = CORPUS.corpus-repo-a;
const present = hasCorpus(PP);
const g = present ? extractDotnet(PP) : extractDotnet(MINI_EFCORE);
const questions = generateEntityMcq(g, 1337);

describe.skipIf(!present)("question generation [corpus]", () => {
  it("produces a question bank from every generator", () => {
    expect(questions.length).toBeGreaterThan(80);
    const gens = new Set(questions.map((q) => q.generator));
    expect(gens.size).toBe(10);
  });

  it("is deterministic for a seed and responsive to a change of seed", () => {
    expect(generateEntityMcq(g, 1337)).toEqual(questions);
    expect(generateEntityMcq(g, 1338)).not.toEqual(questions);
  });

  it("never asks about a delete rule the repo did not write", () => {
    // corpus-repo-a declares no OnDelete anywhere, so a delete-behavior
    // question here would be testing an EF default, not the codebase.
    expect(questions.some((q) => q.generator === "delete-behavior")).toBe(false);
  });

  it("spreads the answer across positions rather than favouring one", () => {
    const counts = [0, 0, 0, 0];
    for (const q of questions) counts[q.answerIndex!] = (counts[q.answerIndex!] ?? 0) + 1;
    const min = Math.min(...counts);
    expect(min / questions.length).toBeGreaterThan(0.1);
  });
});

describe.skipIf(!present)("selftest gate [corpus]", () => {
  it("passes on a real bank", () => {
    expect(selftest(questions)).toEqual([]);
  });

  it("catches a question whose answer index is out of range", () => {
    const bad = structuredClone(questions[0]!);
    bad.answerIndex = 99;
    expect(selftest([bad]).map((f) => f.problem).join()).toContain("answerIndex out of range");
  });

  it("catches a question that can never be failed", () => {
    const bad = structuredClone(questions[0]!);
    bad.choices = [bad.choices![bad.answerIndex!]!];
    bad.answerIndex = 0;
    const problems = selftest([bad]).map((f) => f.problem).join("\n");
    expect(problems).toContain("no mutation exists");
  });

  it("catches two questions that ask the same thing with different answers", () => {
    const a = structuredClone(questions[0]!);
    const b = structuredClone(questions[1]!);
    b.id = `${b.id}.copy`;
    b.prompt = a.prompt;
    const problems = selftest([a, b]).map((f) => f.problem).join("\n");
    expect(problems).toContain("different reference answers");
  });
});

describe.skipIf(!present)("grading [corpus]", () => {
  const q = questions[0]!;

  it("accepts a letter, a number, or the option text", () => {
    const letter = String.fromCharCode(97 + q.answerIndex!);
    expect(grade(q, letter).correct).toBe(true);
    expect(grade(q, String(q.answerIndex! + 1)).correct).toBe(true);
    expect(grade(q, referenceAnswer(q)).correct).toBe(true);
  });

  it("rejects a wrong choice and says what the answer was", () => {
    const wrong = q.answerIndex === 0 ? "b" : "a";
    const r = grade(q, wrong);
    expect(r.correct).toBe(false);
    expect(r.detail).toContain("answer is");
  });

  it("rejects empty and nonsense input", () => {
    expect(grade(q, "").correct).toBe(false);
    expect(grade(q, "zzz").correct).toBe(false);
  });
});

describe.skipIf(!present)("answer normalization [corpus]", () => {
  it("ignores case, spacing, punctuation and namespaces", () => {
    expect(normalize("  ICollection< Order >  ")).toBe("icollection<order>");
    expect(normalize("corpus-repo-a.Api.Models.Domain.County.")).toBe("county");
  });

  it("accepts every spelling of an entity through its aliases", () => {
    const aliases = entityAliases(g, "County");
    for (const spelling of ["County", "counties", "COUNTIES"]) {
      expect(matches(spelling, "County", aliases)).toBe(true);
    }
    expect(matches("Department", "County", aliases)).toBe(false);
    expect(matches("", "County", aliases)).toBe(false);
  });

  it("pluralizes the way EF's DbSet names do", () => {
    expect(plural("County")).toBe("Counties");
    expect(plural("FeedbackEntry")).toBe("FeedbackEntries");
    expect(plural("License")).toBe("Licenses");
    expect(singular("Counties")).toBe("County");
  });
});

describe.skipIf(!present)("quiz selection [corpus]", () => {
  it("spreads a short quiz across generators instead of one", () => {
    const picked = selectQuiz(questions, 6, 7);
    expect(picked).toHaveLength(6);
    expect(new Set(picked.map((q) => q.generator)).size).toBe(6);
  });

  it("is deterministic and never repeats a question", () => {
    const a = selectQuiz(questions, 20, 7);
    expect(selectQuiz(questions, 20, 7)).toEqual(a);
    expect(new Set(a.map((q) => q.id)).size).toBe(20);
  });

  it("returns everything when asked for more than the bank holds", () => {
    expect(selectQuiz(questions, 9999, 7)).toHaveLength(questions.length);
  });
});

describe("deterministic rng", () => {
  it("repeats exactly for a seed and differs across seeds", () => {
    const a = Array.from({ length: 8 }, () => rng(5).next());
    expect(Array.from({ length: 8 }, () => rng(5).next())).toEqual(a);
    expect(rng(6).next()).not.toBe(rng(5).next());
  });

  it("shuffles without losing or duplicating items", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng(3).shuffle(items);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
