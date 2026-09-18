# Plan — demo-harden-drift-pin

**Status:** APPROVED REV (reproduced verbatim below, as approved). This file was
written after the fact, in review round 1, because the task directory shipped
with only an `audit.md` and the approved scope was therefore unverifiable from
the repo. The text between the rules below is the plan as it was approved; it
has not been edited to match what was built.

---

**Task dir:** `feature-research/demo-harden-drift-pin/`

**Files touched:** 1. `test/web-schema-drift.test.ts` — NEW, the only file
written. No production code, no `apps/web`, no `apps/server`, no `packages/*`.

**1. The gate that's actually missing.** `apps/web/src/lib/api.ts:126` mirrors
`EntityGraph` by hand with 8 fields; `@psq/schema` declares 12. `call<T>()` ends
in `return body as T` with no runtime validation, so the drift is silent by
construction and will widen the moment a later phase adds a field. It goes at
root `test/` — NOT in `apps/web`, whose zero-workspace-deps rule is deliberate
and documented at `api.ts:33` — and reads `api.ts` as text. Four assertions,
each with a distinct mutant: (1) `Object.keys(EntityGraph.shape)` == pinned list
of 12, mutant = add/rename a schema field; (2) parsed web interface == pinned
list of 8 and contains `entities`, mutant = rename/reformat so the parse
silently matches nothing; (3) `schema − web` == exactly
`["entityRefs","kind","routes","shapes"]`, mutant = mirror one of the four;
(4) `web − schema` == `[]`, mutant = add a field the server never sends. The
known 4-field gap is an explicit allowlist so the test fails when the gap widens
OR narrows.

**2. Verification.** `pnpm test` (baseline 460/35); `pnpm typecheck` exit 0;
`PSQ_NO_CORPUS=1 pnpm test` skipped must be exactly 58; all mutants' failure
sets recorded suite-wide; `vitest run --config vitest.e2e.config.ts` without
`build:web`.

**3. Out of scope.** No new e2e tests (no refs UI exists to drive; that is
H-a2). No production code changes.

---

## Review round 1 (2026-09-18)

Round-1 review returned **Fix first**. This pass is scoped to that review and
adds no new feature scope. Same "Files touched" rule, plus the two record files.

### Files touched in round 1

1. `test/web-schema-drift.test.ts` — modified (already committed at `c9793e6`;
   round 1 lands on top, not as an amend).
2. `feature-research/demo-harden-drift-pin/audit.md` — modified.
3. `feature-research/demo-harden-drift-pin/plan.md` — NEW (this file).

No production file is touched. Nothing is committed.

### The blocking finding

The parser dropped any `;`-segment whose first token was not the field
identifier, with no trace. Measured by the reviewer against the shipped parser:
`readonly kind: "entity";`, `"kind": "entity";` and `readonly phantomField:
string;` each parsed to 8 fields and left **all four assertions green** — the
first two mirror an allowlisted field (defeating the "gap narrows" direction),
the third invents a field the server never sends (defeating assertion 4).

**Fix:** the parser now returns `{ fields, unparsed }`; every non-empty
`;`-segment that yields no name is collected in `unparsed`, and assertion 2
asserts `unparsed` is empty. `unparsed` is asserted rather than a bare count so
the failure message names the segment that did not parse.

### Mutants added to gate the fix

- **M5** `readonly kind: "entity";` — must redden.
- **M6** `"kind": "entity";` (quoted key) — must redden.
- **M7** `readonly phantomField: string;` — must redden.
- **M8** (added beyond the review's ask) an empty interface body — proves the
  new guard cannot pass by finding nothing: zero segments satisfies
  `unparsed == []` vacuously, so the guard is paired with a not-empty check.

### Audit corrections made

- **A.** The "positive control" rationale was wrong: `toEqual` against an
  8-element pinned list already fails on an empty parse, so `toContain` is a
  diagnostic aid (its *message* distinguishes an empty parse from an extra
  name), not the detection mechanism. Corrected in the test comment and the
  audit.
- **B.** "Assertions 1 and 4 each have a mutant that only they catch" was false
  and has been re-derived over the full M1–M8 table.
- **C.** The unreproducible aggregate `dist` shasum is replaced with per-file
  digests, the exact command that produced the aggregate, and a note that the
  mtime evidence is the stronger proof.
- **D.** The measured parser brittleness cases are now written down.
- **F.** The open-risks section now names the silent-drop direction and the
  other unpinned hand-mirrored interfaces in `api.ts`.

---

## Review round 2 (2026-09-18)

Round-2 review returned **Ship**, with two **non-blocking** items to edit before
the record is committed. This pass is scoped to those two items and adds no new
feature scope.

### Files touched in round 2

1. `test/web-schema-drift.test.ts` — modified (now 179 lines).
2. `feature-research/demo-harden-drift-pin/audit.md` — modified.
3. `feature-research/demo-harden-drift-pin/plan.md` — modified (this file).

Same three paths as round 1. No production file is touched; `apps/web/src/lib/api.ts`
and `packages/schema/src/index.ts` are byte-identical to their pre-mutation
shasums. Nothing is committed.

### Non-blocking item 1 — the last known defeat (declaration merging)

Appending a **second** declaration block to `apps/web/src/lib/api.ts`:

```ts
export interface EntityGraph {
  kind: "entity";
}
```

left all four assertions green. TypeScript merges it into the existing
interface, so `kind` is genuinely on the type, while
`parseWebEntityGraphFields` only ever reads `source.indexOf(MARKER)` — the
first declaration. An allowlisted field could therefore be mirrored with the
gate green: the same defeat class as the round-1 blocking finding, on a
different axis.

**Fix.** The parse now also returns `markerCount`
(`source.split(MARKER).length - 1`), and assertion 2 asserts it is **exactly
1**, with a message that names the second declaration and says that declaration
merging means the parse is no longer authoritative. Exactly-1 also covers the
zero case (rename or reformat) with a better message than the downstream
clauses gave.

**Gated by.** **M9** — append the second block; reddens assertion **2 alone**
at `test/web-schema-drift.test.ts:151` (`expected 2 to be 1`), assertions 1, 3
and 4 green, so it reddens via the new clause and not incidentally.
**M10** — the zero-marker case (rename the interface); reddens at `:151`
(`expected 0 to be 1`) plus assertion 3 at `:172`. The zero case was verified to
be red *before* the new clause too, via the existing parse path.

Declaration merging was verified with a positive control: the probe
`const __probeK: EntityGraph["kind"] = "entity";` typechecks (exit 0) with the
second block and fails `TS2339` (exit 2) without it.

### Non-blocking item 2 — a false claim in the round-1 audit

`audit.md` claimed the `toContain("entities")` clause "is also the clause that
stops the round-1 anti-silent-drop guard from passing vacuously". That is false
in exactly the way round 0's "positive control" claim was false: `:165`'s
`toEqual` against the 8-element pinned list also fails on `[]`, so `:164` merely
**runs first**. Rewritten to the honest statement, with the consequence named:
**deleting `:164` would not move any gate** — it would only degrade a failure
message. It is now labelled documentation, not a gate, per this repo's standing
lesson that a second correct guard makes breakage harder to detect. The test's
own comment block (now at `test/web-schema-drift.test.ts:157-163`) was already
correct and was **not** changed; the audit was brought into line with it.

### What else this pass changed in the record

- The full mutant table **M1–M10 was re-run from scratch** against the final
  file; no row is carried forward. Re-derived failure sets: M1 {1,3}, M2 {2,3},
  M3 {2,3}, M4 {2,4}, M5 {2}, M6 {2}, M7 {2}, M8 {2,3}, M9 {2}, M10 {2,3}.
- Every `file:line` cite in both record files was re-derived against the
  179-line test file — including cites in sections this pass did not rewrite,
  since the guard insertion moved everything from `:104` down.
- The seven round-2 defeat attempts (index signature, modifier on its own line,
  `;` in a string literal type, `extends` form, marker duplicated in a doc
  comment, method signature, trailing comment-only segment) were re-measured as
  full suite runs and folded in as measured-and-red (or, for the last, correctly
  tolerated), shrinking the "NOT MEASURED" line to what is genuinely unmeasured.
- Open risks now distinguishes the **member-syntax** axis from the
  **declaration-merging** axis and records the latter as closed by item 1.
- Recorded that round 2 adjudicated the round-1 "a method signature is tolerant,
  parses to 8" row as **false** — it parses to **7** — and that the reviewer
  confirmed the implementer's disagreement was correct.
- Recorded a one-off `apps/server` 5s timeout seen under the first M7 run that
  did not reproduce across two re-runs and a pristine control.

### Verification (round 2)

`pnpm typecheck` exit **0**; `pnpm test` **36 files / 464 tests passed**;
`PSQ_NO_CORPUS=1 pnpm test` **406 passed | 58 skipped** (skipped is exactly 58).
**e2e was not run** — neither `pnpm test:e2e` (prohibited) nor the direct-config
invocation. `pnpm build` / `pnpm build:web` were never run and `apps/web/dist`
is untouched (0 files newer than 2026-09-17).
