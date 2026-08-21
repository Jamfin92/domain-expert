import type { Question } from "@psq/schema";
import { rng } from "./rng.js";

/**
 * Choose a quiz from a question bank.
 *
 * Slicing the bank in id order hands you N questions from whichever generator
 * happens to sort first — five cardinality questions in a row measure one
 * fact five times. Round-robin across generators instead, so a short quiz
 * still covers foreign keys, nullability, keys, indexes and graph shape.
 *
 * Deterministic for a given seed.
 */
export function selectQuiz(questions: Question[], n: number, seed: number): Question[] {
  if (n >= questions.length) return [...questions];
  const rnd = rng(seed);

  const buckets = new Map<string, Question[]>();
  for (const q of questions) {
    const list = buckets.get(q.generator) ?? [];
    list.push(q);
    buckets.set(q.generator, list);
  }
  // Shuffle within each generator, and fix a stable generator order.
  const names = [...buckets.keys()].sort();
  for (const name of names) buckets.set(name, rnd.shuffle(buckets.get(name)!));

  const out: Question[] = [];
  let round = 0;
  while (out.length < n) {
    let took = 0;
    for (const name of names) {
      if (out.length >= n) break;
      const list = buckets.get(name)!;
      const q = list[round];
      if (q === undefined) continue;
      out.push(q);
      took++;
    }
    if (took === 0) break; // every bucket exhausted
    round++;
  }
  return out;
}
