# demo-harden-drift-pin — PROGRESS

**Status: SHIPPED AND ACCEPTED. James accepted 2026-09-18.** Two review rounds —
round 1 "Fix first" (one blocking finding, in the CODE this time, not the record),
round 2 "Ship" with two non-blocking record edits, both applied before the commit.

Plan `plan.md` (approved; written after the fact and self-declared as such — see
its own note). Audit with every mutant table and measured number: `audit.md`.

On `master` from `56a186c`:

```
c9793e6  test: pin the web EntityGraph mirror against @psq/schema
7eb95a3  docs: demo-harden audit — the drift pin, its mutants, and the e2e run
361336d  test: close the declaration-merging defeat in the drift pin
```

**NOT PUSHED.** `origin/master` is `56a186c`; `master` is 3 ahead. Pushing is a
separate call — this repo is PUBLIC and the push is what publishes the record.

**Measured live at close:** `pnpm test` **464 passed (36 files)** — baseline
460/35, so **+4 and no pre-existing test moved**. `PSQ_NO_CORPUS=1 pnpm test`
**406 passed / 58 skipped** — skipped held at exactly 58, so the gitignored
corpus config is intact. `pnpm typecheck` exit 0. e2e **23/23**, run once via
`pnpm exec vitest run --config vitest.e2e.config.ts` and NOT re-run after later
edits — the record says so rather than implying a fresh run.

## Why this phase existed

It was not on the ladder. James asked for a demo-readiness pass, and the honest
answer to "what is missing" turned out to be one gate, not a feature.

## What shipped

`test/web-schema-drift.test.ts` — a drift pin between `EntityGraph` in
`@psq/schema` (12 fields) and the hand-written mirror at
`apps/web/src/lib/api.ts:126` (8 fields). `call<T>()` ends in `return body as T`
with no runtime validation, so the drift is **silent by construction**.

It lives in root `test/`, NOT in `apps/web`: that app takes no workspace deps on
purpose (`api.ts:33-34`), so the root suite is the only place that can import
`@psq/schema` and still read `api.ts` as text. `api.ts` is read with
`readFileSync` and parsed — never imported as a module.

The known 4-field gap (`kind`, `shapes`, `routes`, `entityRefs`) is an explicit
**allowlist**, so the gate reddens when the gap widens AND when it narrows. A
"should be identical" pin would have been red on arrival.

## The finding this phase turns on

**A parser that drops what it cannot match will pass by finding nothing — at
member granularity, where nobody looks for it.**

Round 0's parser required the identifier to be the first token in a `;`-segment
and silently dropped anything else. Measured: `readonly kind: "entity";`,
`"kind": "entity";` and `readonly phantomField: string;` each mirrored or
invented a field with **all four assertions green**. The round-0 audit had
analysed only the all-or-nothing case ("a rename makes the parse return `[]`,
which is caught") and promised bidirectional gating unconditionally.

Fix: the parser returns `{ fields, unparsed, markerCount }`. Any non-empty
segment yielding no name lands in `unparsed`; a second `export interface
EntityGraph` block (TypeScript **merges** it) reddens on `markerCount`.

## Rules earned

11. **A gate's own parser is a gate.** Ask what its failure mode is before
    trusting what it asserts. A whole-file parse failure is the easy case and
    was handled; the partial drop is the one that ships.
12. **"Exit 0 proves the construct is real" needs the negative run.** The
    declaration-merging defeat was confirmed with a probe that fails (`TS2339`)
    without the second block and passes with it. Without that control, "exit 0"
    proves nothing.
13. **Rule 10 held for a third and fourth time, and the corrections were the
    carriers.** Round 0 claimed a `toContain` clause was the positive control;
    it is not — the paired `toEqual` against an 8-element list fails on `[]` on
    its own. The round-1 fix, written to correct that, **re-credited the same
    clause with preventing vacuity** — the identical error, one pass later. An
    unfalsifiable clause is documentation; label it, do not count it as a gate.

## Decisions, as built

- **Root `test/`, text-parse, never import** — preserves `apps/web`'s zero-deps
  rule, which is deliberate and documented.
- **Pinned literal lists, not counts** — a count misses a rename.
- **Allowlist, not equality** — encodes the known gap so it fails in both
  directions.
- **Assertions 3 and 4 are implied by 1 ∧ 2 and cannot fail alone.** Kept as
  executable documentation of the allowlist; recorded as adding zero detection
  power, not claimed as gates.

## Known gaps, recorded deliberately

- **The marker-count clause has a false RED**: the marker string inside a doc
  comment counts as an occurrence. A comment is not a declaration. Left as-is —
  it is a false red, not a false green, and that case is already red on two
  other clauses.
- **Only `EntityGraph` is pinned.** `api.ts` also hand-mirrors `Layout`,
  `Layout3DNode`, `Shape`, `Route`, `ShapeField`, `Drift`, `UiComponent`,
  `ClientCall`. Sharp edge: **`Route` and `Shape` are two of the four
  allowlisted fields**, so whoever mirrors them will be writing an unpinned
  interface at the same moment they shrink `NOT_MIRRORED`.
- **Comma-separated members** (valid TS) parse only the first field — a false
  RED the marker guard does not catch.
- A nested object literal type truncates at the inner `}` (`indexOf("}", open)`
  is brace-depth-naive). Wrong, but red.

## Flakes

**One fired, and its message WAS captured this time.**
`apps/server/test/api.test.ts > entity search` — **`Test timed out in 5000ms`**,
once, under load during a mutant run. Did not reproduce in two re-runs; the
pristine control was 464/464.

**This is NOT the H-b2 flake** (`reopening replaces the old copy…`): different
test, different mode — a timeout, not an assertion. Keep the two filed
separately, and both separate from the G-b2 `graph endpoints` and 401 flakes.

## Demo-readiness findings (measured 2026-09-18, not code changes)

Recorded because they are expensive to re-derive and two contradict older notes:

- **Open repos SURVIVE a restart.** `store.ts` persists one envelope per repo
  outside the checkout and `rehydrate()` runs after the socket binds. The old
  "workspace is in-memory, restart = repos:0" note is **refuted**. What was true
  is narrower: as of this date the state dir did not exist at all, so nothing
  had ever been opened against that deployment.
- **The server binds the tailnet address only** — `localhost:9451` is refused by
  design, and that is correct, not a fault.
- **`pnpm test:e2e` front-runs `build:web`**, whose `emptyOutDir: true` empties
  the `apps/web/dist` the live server serves per-request. The safe form is
  `pnpm exec vitest run --config vitest.e2e.config.ts` alone — the two commands
  are joined by `&&` and only the first touches dist.
- **e2e cannot pollute the store**: the harness passes no `stateDir`, and
  `Workspace` treats `stateDir === undefined` as persistence off.
- **Entity search, refs and mermaid have no web client method.** `entityRefs` is
  shipped to the browser inside every `/graph` response and discarded. The whole
  H-a/H-b1/H-b2 feature is CLI- and API-only until H-a2.

## Starting the next phase

**H-e — call-vs-mention narrowing + D-Hb-10.** Its inherited premise was
**REFUTED by measurement before any plan was written**; the numbers are in
`feature-research/h-e-call-vs-mention/measurement.md`. Read that first, then
H-b2's `progress.md` for the design it does not repeat, then write a new plan.
