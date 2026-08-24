import type { Question } from "@psq/schema";
import type { DatabaseSync } from "node:sqlite";
import { grade, referenceAnswer, type GradeContext } from "./grade.js";
import { normalize } from "./normalize.js";

/**
 * Two-sided grader validation, after the grader selftest in an earlier internal eval harness.
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

/** Perturb one value so it is definitely wrong but still well-formed. */
function perturb(value: string): string {
  const n = Number(value);
  if (Number.isFinite(n) && value.trim() !== "") {
    // Move a numeric bound far outside the data. Suffixing it would produce a
    // syntax error, which tests the parser rather than the comparison.
    return String(n * 10 + 7);
  }
  return `${value}_psq_wrong`;
}

/**
 * Wrong-but-plausible answers, one per blank.
 *
 * Mutating only the first blank hides a real defect: a question can have a
 * second blank that no answer could ever get wrong. `WHERE gpa >= 3.7 AND
 * gpa < 4.01` against data capped at 4.0 accepts any upper bound above 4.0,
 * so that blank measures nothing. Every blank must be independently
 * detectable or the question is overstating what it tests.
 */
function mutate(q: Question): string[] {
  if (q.gradeMode === "choice") {
    const choices = q.choices ?? [];
    const idx = q.answerIndex ?? -1;
    const other = choices.findIndex((_, i) => i !== idx);
    return other === -1 ? [] : [String(other + 1)];
  }

  // A free-form SQL question has no blanks. Narrow the reference query
  // instead, which changes the result set without changing its shape.
  if (q.gradeMode === "exec" && !q.sqlTemplate) {
    const sql = q.referenceSql;
    if (!sql) return [];
    // Appending a second LIMIT would be a syntax error, which would "fail"
    // for the wrong reason and prove nothing about the grader.
    if (/\blimit\b/i.test(sql)) return [];
    return [`${sql} LIMIT 1`];
  }

  const answers = q.answers ?? [];
  if (answers.length === 0) return [];

  return answers.map((_, i) => {
    const mutated = [...answers];
    mutated[i] = perturb(answers[i]!);
    return mutated.join(", ");
  });
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

  if (q.gradeMode === "exec") {
    if (!q.referenceSql) out.push("exec question has no reference query");
    if (q.sqlTemplate) {
      const blanks = (q.sqlTemplate.match(/____/g) ?? []).length;
      const answers = (q.answers ?? []).length;
      if (blanks !== answers) {
        out.push(`template has ${blanks} blank(s) but ${answers} answer(s)`);
      }
    }
  }
  return out;
}

/**
 * Validate a question set. An empty result means every question is both
 * answerable and failable.
 */
export function selftest(
  questions: Question[],
  ctx: GradeContext = {},
): SelftestFinding[] {
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

    if (q.gradeMode === "exec" && !ctx.db) {
      add("exec question cannot be validated without a seeded database");
      continue;
    }

    // For a free-form SQL question the reference query IS the model answer.
    const modelAnswer =
      q.gradeMode === "exec" && !q.sqlTemplate ? (q.referenceSql ?? "") : referenceAnswer(q);

    const positive = grade(q, modelAnswer, ctx);
    if (!positive.correct) {
      add(`reference answer is graded wrong (${positive.detail})`);
    }

    const wrongs = mutate(q);
    if (wrongs.length === 0) {
      add("no mutation exists, so the question can never be failed");
      continue;
    }
    for (const [i, wrong] of wrongs.entries()) {
      const negative = grade(q, wrong, ctx);
      if (negative.correct) {
        const where = wrongs.length > 1 ? `blank ${i + 1}` : "the answer";
        add(
          `${where} cannot be got wrong: "${wrong}" is graded correct, ` +
            "so that part of the question measures nothing",
        );
      }
    }
  }

  return findings;
}
