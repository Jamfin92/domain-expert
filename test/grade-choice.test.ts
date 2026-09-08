import { describe, expect, it } from "vitest";
import { grade } from "@psq/quiz";
import type { Question } from "@psq/schema";

/**
 * Phase F (D-F-1). Choice grading precedence: an exact choice text always
 * wins; the "2" / "b" shortcut applies only to input matching no choice.
 *
 * The regression this pins is that a one-character choice used to be
 * unreachable by its own text — `/^[a-z]$/i` tested the *shape of the input*
 * and never looked at the choices, so `"X"` was read as option 24 of a
 * four-option question. Cases 1 and 8 fail before the reorder.
 *
 * Hermetic: literal questions, no fixture, no graph.
 */
function mcq(choices: string[], answerIndex: number): Question {
  return {
    id: "q1",
    section: "ds",
    kind: "mcq",
    gradeMode: "choice",
    generator: "test",
    prompt: "which one?",
    choices,
    answerIndex,
    subjects: [],
    rationale: "hand-written",
  };
}

describe("grade, choice mode", () => {
  it("1. accepts a one-character choice by its text at a non-zero index", () => {
    const q = mcq(["Pending", "X", "Approved", "Denied"], 1);
    expect(grade(q, "X").correct).toBe(true);
  });

  it("2. rejects a different member's text on that same question", () => {
    const q = mcq(["Pending", "X", "Approved", "Denied"], 1);
    expect(grade(q, "Approved").correct).toBe(false);
  });

  it("3. keeps the letter shortcut when no choice is that letter", () => {
    const q = mcq(["Alpha", "Bravo", "Charlie", "Delta"], 1);
    expect(grade(q, "b").correct).toBe(true);
    expect(grade(q, "a").correct).toBe(false);
  });

  it("4. keeps the number shortcut when no choice is that number", () => {
    const q = mcq(["Alpha", "Bravo", "Charlie", "Delta"], 1);
    expect(grade(q, "2").correct).toBe(true);
    expect(grade(q, "1").correct).toBe(false);
  });

  it("5. accepts full choice text for its own index", () => {
    const q = mcq(["Alpha", "Bravo", "Charlie", "Delta"], 2);
    expect(grade(q, "Charlie").correct).toBe(true);
  });

  it("6. grades input matching no choice and no valid shortcut wrong, not index 0", () => {
    const q = mcq(["Alpha", "Bravo", "Charlie", "Delta"], 0);
    const r = grade(q, "Zulu");
    expect(r.correct).toBe(false);
    expect(r.detail).toContain('"Zulu"');
  });

  it("7. pins the ambiguity: a choice spelled like an option letter wins as text", () => {
    const q = mcq(["b", "Alpha", "Bravo", "Charlie"], 0);
    expect(grade(q, "b").correct).toBe(true);
    const shifted = mcq(["b", "Alpha", "Bravo", "Charlie"], 1);
    expect(grade(shifted, "b").correct).toBe(false);
  });

  it("8. accepts a one-character choice past 'd', structurally out of range before", () => {
    const q = mcq(["Alpha", "Bravo", "X", "Delta"], 2);
    expect(grade(q, "X").correct).toBe(true);
  });
});
