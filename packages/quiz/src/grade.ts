import type { DatabaseSync } from "node:sqlite";
import type { GradeResult, Question } from "@psq/schema";
import { matches, normalize } from "./normalize.js";
import { runQuery, resultsMatch } from "./sql/sandbox.js";

/** Extra inputs some grade modes need. `exec` needs a seeded database. */
export interface GradeContext {
  db?: DatabaseSync;
}

/** Substitute answers into a `____` template, in order. */
export function fillTemplate(template: string, values: string[]): string {
  let i = 0;
  return template.replace(/____/g, () => values[i++] ?? "");
}

/**
 * Deterministic grading. No model is consulted, ever.
 *
 * An agent may author a question's prose; it may never decide whether an
 * answer is right. Every question therefore carries its own grader inputs —
 * a choice index, canonical text plus aliases, or a reference query.
 */

/** The canonical answer text, used by review screens and by selftest. */
export function referenceAnswer(q: Question): string {
  if (q.gradeMode === "choice") {
    return q.choices?.[q.answerIndex ?? -1] ?? "";
  }
  return (q.answers ?? []).join(", ");
}

/**
 * Grade a response.
 *
 * `given` is the raw text for token questions, or the selected option — either
 * its index as a string, or the option text — for choice questions.
 */
export function grade(q: Question, given: string, ctx: GradeContext = {}): GradeResult {
  switch (q.gradeMode) {
    case "choice": {
      const choices = q.choices ?? [];
      const idx = q.answerIndex ?? -1;
      const answer = choices[idx];
      if (answer === undefined) {
        return { questionId: q.id, correct: false, detail: "question has no answer index" };
      }
      const trimmed = given.trim();
      // Precedence: an exact choice text always wins; the "2"/"b" shortcut
      // applies only to input that matches no choice. Testing the shape of the
      // input first made a one-character choice unreachable by its own text —
      // "X" was read as option 24 of a four-option question — so the choice
      // list has to be consulted before the shortcut, not after it.
      let picked = choices.findIndex((c) => normalize(c) === normalize(trimmed));
      if (picked === -1) {
        if (/^\d+$/.test(trimmed)) picked = Number(trimmed) - 1;
        else if (/^[a-z]$/i.test(trimmed)) picked = trimmed.toLowerCase().charCodeAt(0) - 97;
      }

      return {
        questionId: q.id,
        correct: picked === idx,
        detail: picked === idx
          ? `chose ${answer}`
          : `chose ${choices[picked] ?? `"${trimmed}"`}, answer is ${answer}`,
      };
    }

    case "token": {
      const answers = q.answers ?? [];
      const aliases = q.aliases ?? [];
      // Multiple blanks arrive comma-separated, in order.
      const parts = given.split(",").map((s) => s.trim());
      if (parts.length !== answers.length) {
        return {
          questionId: q.id,
          correct: false,
          detail: `expected ${answers.length} value(s), got ${parts.length}`,
        };
      }
      for (let i = 0; i < answers.length; i++) {
        if (!matches(parts[i] ?? "", answers[i]!, aliases[i] ?? [])) {
          return {
            questionId: q.id,
            correct: false,
            detail: `blank ${i + 1}: "${parts[i]}" does not match "${answers[i]}"`,
          };
        }
      }
      return { questionId: q.id, correct: true, detail: "all blanks match" };
    }

    case "exec": {
      const db = ctx.db;
      if (!db) {
        return { questionId: q.id, correct: false, detail: "no database was supplied" };
      }
      if (!q.referenceSql) {
        return { questionId: q.id, correct: false, detail: "question has no reference query" };
      }

      // A templated question fills blanks; a free question is the whole query.
      const candidateSql = q.sqlTemplate
        ? fillTemplate(q.sqlTemplate, given.split(",").map((s) => s.trim()))
        : given;

      const candidate = runQuery(db, candidateSql);
      if (!candidate.ok) {
        return {
          questionId: q.id,
          correct: false,
          detail: candidate.rejected ? `refused: ${candidate.error}` : `query failed: ${candidate.error}`,
        };
      }

      const reference = runQuery(db, q.referenceSql);
      if (!reference.ok) {
        // The reference is psq's own; if it cannot run, that is a generator bug.
        return {
          questionId: q.id,
          correct: false,
          detail: `reference query failed: ${reference.error}`,
        };
      }

      const cmp = resultsMatch(reference, candidate, q.referenceSql);
      return { questionId: q.id, correct: cmp.same, detail: cmp.detail };
    }

    default: {
      const never: never = q.gradeMode;
      return { questionId: q.id, correct: false, detail: `unknown grade mode ${String(never)}` };
    }
  }
}
