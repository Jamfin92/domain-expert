import type { GradeResult, Question } from "@psq/schema";
import { matches, normalize } from "./normalize.js";

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
export function grade(q: Question, given: string): GradeResult {
  switch (q.gradeMode) {
    case "choice": {
      const choices = q.choices ?? [];
      const idx = q.answerIndex ?? -1;
      const answer = choices[idx];
      if (answer === undefined) {
        return { questionId: q.id, correct: false, detail: "question has no answer index" };
      }
      const trimmed = given.trim();
      // Accept "2", "b", or the option text itself.
      let picked = -1;
      if (/^\d+$/.test(trimmed)) picked = Number(trimmed) - 1;
      else if (/^[a-z]$/i.test(trimmed)) picked = trimmed.toLowerCase().charCodeAt(0) - 97;
      else picked = choices.findIndex((c) => normalize(c) === normalize(trimmed));

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

    case "exec":
      // Implemented in M2 alongside schema materialization and seeding.
      return {
        questionId: q.id,
        correct: false,
        detail: "exec grading is not available yet",
      };

    default: {
      const never: never = q.gradeMode;
      return { questionId: q.id, correct: false, detail: `unknown grade mode ${String(never)}` };
    }
  }
}
