import type { Question } from "@psq/schema";
import { grade, referenceAnswer } from "./grade.js";
import { normalize } from "./normalize.js";

/**
 * Two-sided grader validation, after the selftest in an earlier internal eval harness.
 *
 * A question that always passes is indistinguishable from a question whose
 * grader is broken, and a question that can never pass is worse. So every
 * question must be proven BOTH answerable with its reference answer AND
 * failable with a mutation. Anything that cannot be failed is a defect in the
 * generator, not a hard question.
 */

export interface SelftestFinding {
  questionId: string;
  generator: string;
  problem: string;
}

/**
 * A wrong-but-plausible answer for a question.
 * Returns null when no mutation exists, which is itself reported.
 */
function mutate(q: Question): string | null {
  if (q.gradeMode === "choice") {
    const choices = q.choices ?? [];
    const idx = q.answerIndex ?? -1;
    const other = choices.findIndex((_, i) => i !== idx);
    return other === -1 ? null : String(other + 1);
  }
  const answers = q.answers ?? [];
  if (answers.length === 0) return null;
  // Perturb the first blank only, so the rest stay valid and the failure is
  // attributable to the mutation rather than to a shape mismatch.
  const mutated = [...answers];
  mutated[0] = `${answers[0]}_psq_wrong`;
  return mutated.join(", ");
}

/** Structural checks that do not need the grader. */
function shapeProblems(q: Question): string[] {
  const out: string[] = [];
  if (q.prompt.trim().length === 0) out.push("empty prompt");
  if (q.rationale.trim().length === 0) out.push("empty rationale");
  if (q.subjects.length === 0) out.push("no subjects, so weak-area rollups cannot attribute it");

  if (q.gradeMode === "choice") {
    const choices = q.choices ?? [];
    if (choices.length < 3) out.push(`only ${choices.length} choices`);
    if (new Set(choices).size !== choices.length) out.push("duplicate choices");
    // Two options that normalize to the same string read as one option to a
    // human and make the question unanswerable.
    const normed = choices.map((c) => normalize(c));
    if (new Set(normed).size !== normed.length) out.push("choices collide after normalization");
    const idx = q.answerIndex ?? -1;
    if (idx < 0 || idx >= choices.length) out.push("answerIndex out of range");
  }

  if (q.gradeMode === "token") {
    const answers = q.answers ?? [];
    if (answers.length === 0) out.push("no canonical answer");
    if (answers.some((a) => a.trim().length === 0)) out.push("blank canonical answer");
    if (!q.prompt.includes("____")) out.push("token question has no ____ blank marker");
  }

  if (q.gradeMode === "exec" && !q.referenceSql) out.push("exec question has no reference query");
  return out;
}

/**
 * Validate a question set. An empty result means every question is both
 * answerable and failable.
 */
export function selftest(questions: Question[]): SelftestFinding[] {
  const findings: SelftestFinding[] = [];
  const seenIds = new Set<string>();

  // Cross-question ambiguity: the same prompt with two different answers means
  // at least one of them is wrong, and the reader cannot tell which. Per
  // question this is invisible; it only shows up across the whole set.
  const answersByPrompt = new Map<string, Map<string, string[]>>();
  for (const q of questions) {
    const byAnswer = answersByPrompt.get(q.prompt) ?? new Map<string, string[]>();
    const ids = byAnswer.get(referenceAnswer(q)) ?? [];
    ids.push(q.id);
    byAnswer.set(referenceAnswer(q), ids);
    answersByPrompt.set(q.prompt, byAnswer);
  }
  for (const [prompt, byAnswer] of answersByPrompt) {
    if (byAnswer.size < 2) continue;
    for (const ids of byAnswer.values()) {
      for (const id of ids) {
        const q = questions.find((x) => x.id === id)!;
        findings.push({
          questionId: id,
          generator: q.generator,
          problem:
            `prompt has ${byAnswer.size} different reference answers across the set ` +
            `(${[...byAnswer.keys()].join(" | ")}): "${prompt}"`,
        });
      }
    }
  }

  for (const q of questions) {
    const add = (problem: string): void => {
      findings.push({ questionId: q.id, generator: q.generator, problem });
    };

    if (seenIds.has(q.id)) add("duplicate question id");
    seenIds.add(q.id);

    for (const p of shapeProblems(q)) add(p);

    // exec grading arrives in M2; skip its two-sided check until then.
    if (q.gradeMode === "exec") continue;

    const positive = grade(q, referenceAnswer(q));
    if (!positive.correct) {
      add(`reference answer is graded wrong (${positive.detail})`);
    }

    const wrong = mutate(q);
    if (wrong === null) {
      add("no mutation exists, so the question can never be failed");
      continue;
    }
    const negative = grade(q, wrong);
    if (negative.correct) {
      add(`mutated answer "${wrong}" is graded correct, so the question always passes`);
    }
  }

  return findings;
}
