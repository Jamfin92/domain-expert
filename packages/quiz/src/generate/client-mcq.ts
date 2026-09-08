import type { Component, EntityGraph, Question } from "@psq/schema";
import { hashSeed, rng, type Rng } from "../rng.js";
import { normalize } from "../normalize.js";
import { componentLabel } from "./component-label.js";

/**
 * Deterministic multiple-choice questions about the client half of a graph:
 * which UI component talks to the API most.
 *
 * Same rules as the entity generators. The graded field is a component NAME
 * (labelled only as far as disambiguation requires); the count that makes the
 * answer true lives in the rationale, never in a choice — the `mostConnected`
 * idiom. A number in the choice list would be a second, unstated axis to
 * grade on.
 */

const MIN_CHOICES = 3;

interface Ctx {
  g: EntityGraph;
  rnd: Rng;
}

/**
 * Assemble a choice list with the answer placed at a seeded position.
 *
 * A local copy rather than `entity-mcq.ts`'s: that one hardcodes
 * `section: "entity"`, and `ds-mcq.ts` already carries the same copy for the
 * same reason.
 */
function mcq(
  ctx: Ctx,
  parts: {
    id: string;
    generator: string;
    prompt: string;
    answer: string;
    distractors: string[];
    subjects: string[];
    rationale: string;
  },
): Question | null {
  const pool = [...new Set(parts.distractors.filter((d) => d !== parts.answer))];
  if (pool.length + 1 < MIN_CHOICES) return null;
  const chosen = ctx.rnd.sample(pool, 3);
  const choices = ctx.rnd.shuffle([parts.answer, ...chosen]);
  return {
    id: parts.id,
    section: "client",
    kind: "mcq",
    gradeMode: "choice",
    generator: parts.generator,
    prompt: parts.prompt,
    choices,
    answerIndex: choices.indexOf(parts.answer),
    subjects: parts.subjects,
    rationale: parts.rationale,
  };
}

/**
 * A choice that can never be selected by typing it: `grade.ts:52` reads a
 * single letter as an option letter before the text branch at `:53` runs, so
 * a one-character choice is unreachable by text and the question is not
 * fully failable. That is a live bug in the grader — one confirmed casualty
 * elsewhere in the bank — and it is not this generator's to fix; shipping
 * into it would be.
 *
 * A property of ONE choice, so it is filtered out of the distractor pool
 * rather than used to drop the question: a bad distractor costs one option, a
 * bad answer costs the question.
 */
function unselectable(choice: string): boolean {
  return choice.trim().length <= 1;
}

/**
 * True when two choices reduce to the same string under `normalize()`.
 *
 * This is the invariant itself, checked exactly as `selftest.ts:84-85` checks
 * it, rather than a proxy for it. An earlier draft tested each choice for a
 * `.`, reasoning from `normalize.ts:24` — which does collapse dotted labels,
 * but is neither necessary nor sufficient:
 *
 *  - NOT SUFFICIENT. `normalize()` also lowercases (`normalize.ts:15`), while
 *    `componentLabel` compares names with `===`. `refs.ts:69` admits any
 *    `/^[A-Z][A-Za-z0-9]*$/` name, so `Api` and `API` are two distinct
 *    components, both unique, both labelled bare, and neither holds a dot —
 *    yet they collide, and `psq selftest` reports the question broken.
 *  - NOT NECESSARY. One dotted label among clean ones collapses to something
 *    no other choice shares, so the set still grades correctly. The dot rule
 *    dropped those questions for nothing.
 *
 * Checked on the FINAL choice list, after sampling, because that list is what
 * selftest sees. Rule 1: a question that cannot be graded deterministically
 * does not ship.
 */
function choicesCollide(choices: readonly string[]): boolean {
  const normed = choices.map(normalize);
  return new Set(normed).size !== normed.length;
}

/** "Which component makes the most API calls?" */
function busiestComponent(ctx: Ctx): Question[] {
  const components = ctx.g.components;
  // Mirrors `mostConnected`: fewer than four and there are not enough real
  // siblings to fill a choice list without padding it with junk.
  if (components.length < 4) return [];

  const counts = new Map<string, number>();
  for (const c of components) counts.set(c.key, 0);
  for (const call of ctx.g.clientCalls) {
    for (const key of call.components) {
      // A key resolving against no component would be a fabricated fact.
      // (`client-calls.ts:47-49` drops such a row too, but for a presentational
      // reason of its own — it would render a group with no header — so it is
      // the same behaviour, not the same argument.)
      const n = counts.get(key);
      if (n !== undefined) counts.set(key, n + 1);
    }
  }

  // Ordered before any use of `rnd`, and total: count descending, then key
  // ascending. Two components can share a name but never a key, so the order
  // is fully determined by the graph (rule 7).
  const byKey = new Map<string, Component>(components.map((c) => [c.key, c]));
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, count]) => ({ component: byKey.get(key) as Component, count }));

  const top = ranked[0]!;
  const next = ranked[1]!;
  // Nothing calls anything: "the most" would be a question about zero.
  if (top.count === 0) return [];
  // A tied top would have two right answers.
  if (next.count === top.count) return [];

  const answer = componentLabel(ctx.g, top.component);
  // An unselectable ANSWER has no substitute, so the question goes. An
  // unselectable distractor is merely one option fewer: dropping the question
  // over a label that `sample()` would probably never draw would let one odd
  // component in a 200-component repo silence the generator entirely.
  if (unselectable(answer)) return [];
  const distractors = ranked
    .slice(1)
    .map((r) => componentLabel(ctx.g, r.component))
    .filter((d) => !unselectable(d));

  const q = mcq(ctx, {
    id: "client.busiest",
    generator: "most-calls",
    prompt: "Which component makes the most API calls?",
    answer,
    distractors,
    // The bare name, as every other generator does (`ds-mcq.ts` passes
    // `shape.name`, not the label). Two same-named components share one
    // subject; that is the right grouping for a weak-area rollup.
    subjects: [top.component.name],
    rationale:
      `${answer} makes ${top.count} API calls; the next highest is ` +
      `${componentLabel(ctx.g, next.component)} with ${next.count}.`,
  });
  if (!q) return [];
  // Last, because it reads the sampled list rather than the candidate pool.
  if (choicesCollide(q.choices ?? [])) return [];
  return [q];
}

const GENERATORS = [busiestComponent];

/**
 * Every client-section multiple-choice question for a graph.
 * Deterministic: the same graph and seed always produce the same list.
 */
export function generateClientMcq(g: EntityGraph, seed?: number): Question[] {
  const ctx: Ctx = { g, rnd: rng(seed ?? hashSeed(g.repo)) };
  const out: Question[] = [];
  for (const gen of GENERATORS) out.push(...gen(ctx));
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
