import type { Component, EntityGraph } from "@psq/schema";

/**
 * `component.name` when the name is unique in `g.components`, else
 * `"<name> (<file with its extension dropped>)"`. Extraction keys components
 * by `<file>#<name>`, so the labelled form is unique whenever the component
 * is. Exact, case-sensitive match, matching `shapeLabel`.
 *
 * THE DROPPED EXTENSION IS LOAD-BEARING, and this is where this label
 * deliberately parts company with `apps/web/src/lib/client-calls.ts`'s
 * `componentLabel`, which keeps it. `normalize.ts:20-24` drops namespace
 * qualification by slicing the head symbol at its LAST `.`; with no `<` in the
 * string the head is the whole string, so `"Card (src/…/Card.tsx)"` normalizes
 * to `"tsx)"` — and so does every other such label. `grade.ts:53` then matches
 * any typed answer against choice 0, and `selftest` reports both
 * "choices collide after normalization" and "reference answer is graded
 * wrong": the question becomes unfailable, which rule 5 forbids.
 *
 * `shapeLabel` produces the extension-bearing format safely because it is only
 * ever interpolated into PROMPTS, which `normalize()` never touches. In choice
 * text the same format is fatal. Do not "re-align" the two copies.
 *
 * Stripping the extension is necessary, not sufficient. It is not the only
 * way two labels can reduce to one string — `normalize()` also lowercases, so
 * `Api` and `API` are two components by this function's exact `===` test and
 * one choice by selftest's — so `client-mcq.ts` checks the invariant itself,
 * `choicesCollide()`, on the final choice list, and drops the question rather
 * than shipping one selftest would report.
 */
export function componentLabel(g: EntityGraph, component: Component): string {
  let n = 0;
  for (const c of g.components) if (c.name === component.name && ++n > 1) break;
  if (n <= 1) return component.name;
  // Last extension only, and never one that is really a directory separator.
  const file = component.file.replace(/\.[^./]*$/, "");
  return `${component.name} (${file})`;
}
