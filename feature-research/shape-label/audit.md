# Phase C — 1b-ii `shapeLabel` — IMPLEMENTER AUDIT

Branch `1b-ii-shape-label`, created from `master` at `37960f2`.
Feature commit: **`744565f`**.

## Files changed

| Path | Status |
|---|---|
| `packages/quiz/src/generate/shape-label.ts` | new |
| `packages/quiz/src/index.ts` | modified |
| `packages/quiz/src/generate/ds-mcq.ts` | modified |
| `packages/quiz/src/generate/ds-cloze.ts` | modified |
| `test/shape-label.test.ts` | new |
| `test/mini-fullstack-csharp.test.ts` | modified |

Nothing else. `feature-research/shape-label/audit.md` (this file) is left
uncommitted for the record commit.

## What changed, per file

- **`packages/quiz/src/generate/shape-label.ts`** (new, 11 lines) — the helper
  exactly as written in the plan's "Design" block: linear scan of `g.shapes`,
  exact case-sensitive name match, returns `shape.name` or
  `` `${shape.name} (${shape.file})` ``. No state, no memoisation (D-C-6).
- **`packages/quiz/src/index.ts`** — one appended line,
  `export { shapeLabel } from "./generate/shape-label.js";`, matching the
  barrel's one-export-per-line style.
- **`packages/quiz/src/generate/ds-mcq.ts`** — one new import; sites 1–3
  (`optionalField`, `collectionField`, `notAMember`) each gain
  `const label = shapeLabel(ctx.g, shape);` immediately before their
  `mcq(ctx, {…})` call and use `${label}` in the `prompt` template only. Ids,
  `subjects`, `rationale`, options and answers untouched. `fieldDrift` and
  `dtoOnlyField` untouched (D-C-3). No reformatting.
- **`packages/quiz/src/generate/ds-cloze.ts`** — one new import; sites 4–5
  (`fieldType`, `discriminator`) same treatment. `storageClass` and the other
  generator untouched.
- **`test/shape-label.test.ts`** (new, 5 tests) — local `shape(name, file)` and
  `graph(shapes)` helpers in the style of `packages/extract/test/merge.test.ts`.
  Cases: unique name returns bare (and explicitly *not* the labelled form);
  two twins each labelled with their own file and the labels differ; three
  same-named shapes all labelled and all distinct; every shape of the extracted
  `MINI_NODE` graph returns bare, guarded by `expect(g.shapes.length)
  .toBeGreaterThanOrEqual(2)` so the loop is not vacuous; `Foo` vs `foo` in
  different files both bare.
- **`test/mini-fullstack-csharp.test.ts`** — in
  `"yields a bank worth running the selftest against"`, the three floor
  assertions (≥4 questions, ≥2 generators, exactly 2 `field-optional`) are
  unchanged. The red block is replaced by `expect(selftest(questions))
  .toEqual([])`, the two sorted labelled prompts pinned exactly, and the two
  sorted ids pinned unchanged. The comment block is rewritten to state the
  1b-ii guard, why the label carries the file, and that ids never changed; the
  "out of scope here / Phase 1b-ii" sentences are gone.

## Step 1 — baselines at `37960f2` (before any edit)

- `pnpm typecheck` → clean (no diagnostics).
- `PSQ_NO_CORPUS=1 pnpm test` → `Tests  225 passed | 58 skipped (283)`,
  `Test Files  17 passed | 3 skipped (20)`.
- `pnpm test` → `Tests  283 passed (283)`, `Test Files  20 passed (20)`.

### `pnpm selftest --repo R` per root

| Root | exit | summary line | findings (generator/id) |
|---|---|---|---|
| fixture `mini-fullstack-csharp` | 1 | `selftest failed — 2 finding(s) across 16 questions` | `field-optional/ds.optional.client/src/types/product-dto.ts.ProductDto`; `field-optional/ds.optional.server/Dtos/ProductDto.cs.ProductDto` — both `prompt has 2 different reference answers across the set (description \| Description)` |
| Northwind full-stack (`~/Developer/northwind-fullstack`) | 1 | `selftest failed — 2 finding(s) across 113 questions` | `field-collection/ds.collection.client/src/lib/api-types.ts.OrderDto`; `field-collection/ds.collection.server/Dtos/NorthwindDtos.cs.OrderDto` — both `(details \| Details)` |
| Northwind server-only | 0 | `selftest ok — 97 questions` | — |
| `repoA` | 0 | `selftest ok — 213 questions` | — |
| `repoB` | 0 | `selftest ok — 107 questions` | — |
| `repoC` | 0 | `selftest ok — 2 questions` | — |
| `repoD` | 0 | `selftest ok — 132 questions` | — |
| `repoE` | 0 | `selftest ok — 56 questions` | — |
| `repoAClient` | 1 | `selftest failed — 5 finding(s) across 88 questions` | 2 × `field-collection` + 2 × `not-a-member` — prompt-ambiguity; **plus** 1 × `not-a-member` — `reference answer is graded wrong` (out of scope, D-C-7). Finding ids withheld (corpus material). |

Before-banks written with `pnpm psq questions --repo R --seed 7 --out
<scratch>/before/<key>` for all nine roots (exit 0, 2 files each). Scratch
lives in the session scratchpad, never in the repo.

### Duplicated shape names (throwaway tsx script, `extract()`, one root per process)

| Root | shapes | duplicated names | plan's table | match |
|---|---|---|---|---|
| fixture | 3 | **1** — `ProductDto` (×2) | 1 | yes |
| Northwind full-stack | 43 | **9** — `CategoryDto`, `CustomerDto`, `EmployeeDto`, `OrderDetailDto`, `OrderDto`, `OrderSummaryDto`, `ProductDto`, `ShipperDto`, `SupplierDto`, each ×2 | 9 | yes |
| Northwind server-only | 10 | **0** | 0 | yes |
| `repoA` | 36 | **0** | 0 | yes |
| `repoB` | 15 | **0** | 0 | yes |
| `repoC` | 5 | **0** | 0 | yes |
| `repoD` | 152 | **3** | 3 | yes |
| `repoE` | 40 | **0** | 0 | yes |
| `repoAClient` | 195 | **8** | 8 | yes |

Names are given only for the fixture and Northwind, as the plan directs;
corpus shape names are withheld.

## Build log (brief)

1. `git switch -c 1b-ii-shape-label master` from a clean tree at `37960f2`
   (only `feature-research/shape-label/` untracked).
2. Baselines above.
3. Added `shape-label.ts` + barrel line + `test/shape-label.test.ts`;
   `pnpm vitest run test/shape-label.test.ts` → `5 passed (5)` first run.
4. Applied `${label}` at the five prompt sites (three in `ds-mcq.ts`, two in
   `ds-cloze.ts`).
5. Flipped `test/mini-fullstack-csharp.test.ts`.
6. Gates, sweeps, commit.

## Step 5 — gates

### `pnpm typecheck`
Clean — `tsc -p tsconfig.json --noEmit && tsc -p e2e/tsconfig.json --noEmit &&
… @psq/web … @psq/desktop` all returned with no diagnostics.

### `PSQ_NO_CORPUS=1 pnpm test`
`Test Files  18 passed | 3 skipped (21)` / `Tests  230 passed | 58 skipped (288)`
— 0 failed. Required ≥230 passed | 58 skipped: **met** (225 + 5 new).

### `pnpm test`
`Test Files  21 passed (21)` / `Tests  288 passed (288)` — 0 failed.
288 = 230 hermetic + 58 corpus. **met**.

### `pnpm test:e2e`
**Not run** (D-C-10). `pnpm build:web` would empty the `apps/web/dist` the live
`com.psq.server` serves from disk.

### `pnpm selftest --repo R`, after

| Root | exit | summary line | findings |
|---|---|---|---|
| fixture | **0** | `selftest ok — 16 questions, each answerable with its reference answer and each failable with a mutation` | — |
| Northwind full-stack | **0** | `selftest ok — 113 questions, …` | — |
| Northwind server-only | 0 | `selftest ok — 97 questions, …` | — |
| `repoA` | 0 | `selftest ok — 213 questions, …` | — |
| `repoB` | 0 | `selftest ok — 107 questions, …` | — |
| `repoC` | 0 | `selftest ok — 2 questions, …` | — |
| `repoD` | 0 | `selftest ok — 132 questions, …` | — |
| `repoE` | 0 | `selftest ok — 56 questions, …` | — |
| `repoAClient` | 1 | `selftest failed — 1 finding(s) across 88 questions` | exactly one: `not-a-member` — `reference answer is graded wrong` (id withheld, corpus material) |

All four prompt-ambiguity findings on `repoAClient` are gone; the one that
remains is the graded-wrong class this phase does not touch (D-C-7). No
remaining finding anywhere has problem `prompt has N different reference
answers` on a `ds.optional.` / `ds.collection.` / `ds.member.` /
`ds.cloze.type.` / `ds.cloze.disc.` id.

### Bank diff per root (`after` vs `before`, `<out>/questions/entity.json`)

Compared with a scratchpad node script: `jq`-equivalent `[.[].id]` list
equality, `map(del(.prompt))` equality, and for every differing prompt, the
shape name parsed out of the id checked against that root's duplicated-name
set from step 1 plus a `(<file>)` substring check on the new prompt.

| Root | ids identical | non-prompt fields identical | changed / total | violations | `diff -r` |
|---|---|---|---|---|---|
| fixture | yes (16/16) | yes | **2 / 16** | 0 | non-empty |
| Northwind full-stack | yes (113/113) | yes | **2 / 113** | 0 | non-empty |
| Northwind server-only | yes (97/97) | yes | 0 / 97 | 0 | **EMPTY (exit 0)** |
| `repoA` | yes (213/213) | yes | 0 / 213 | 0 | **EMPTY (exit 0)** |
| `repoB` | yes (107/107) | yes | 0 / 107 | 0 | **EMPTY (exit 0)** |
| `repoC` | yes (2/2) | yes | 0 / 2 | 0 | **EMPTY (exit 0)** |
| `repoD` | yes (132/132) | yes | **4 / 132** | 0 | non-empty |
| `repoE` | yes (56/56) | yes | 0 / 56 | 0 | **EMPTY (exit 0)** |
| `repoAClient` | yes (88/88) | yes | **16 / 88** | 0 | non-empty |

- **Positive control:** non-empty prompt diff on exactly the four roots with
  duplicated names — fixture (2 ≥ 2), Northwind full-stack (2 ≥ 2), `repoD`
  (4), `repoAClient` (16 ≥ 4). Required, met.
- **Byte-identical control:** `diff -r before/<key> after/<key>` empty (exit 0)
  on the five roots with 0 duplicated names, named: **Northwind server-only,
  `repoA`, `repoB`, `repoC`, `repoE`**. Required, met.
- Every changed prompt's shape name is in its root's duplicated-name set and
  the new prompt contains `(<file>)` for the file in its id — 0 violations
  across all nine roots.

### `git show --stat HEAD`

```
commit 744565f00945b2674e092886bbc96d0305150375
    feat(quiz): label duplicate shape names with their file in DS prompts

 packages/quiz/src/generate/ds-cloze.ts    |  7 ++-
 packages/quiz/src/generate/ds-mcq.ts      | 10 +++-
 packages/quiz/src/generate/shape-label.ts | 11 ++++
 packages/quiz/src/index.ts                |  1 +
 test/mini-fullstack-csharp.test.ts        | 39 +++++++------
 test/shape-label.test.ts                  | 93 +++++++++++++++++++++++++++++++
 6 files changed, 138 insertions(+), 23 deletions(-)
```

Exactly the six paths in the plan's "Files touched" table, nothing else.
`git status --porcelain` after the commit shows only the untracked
`feature-research/shape-label/`.

## Step 6 — sweeps (run before the commit, positive control first)

Targets in both sweeps: `feature-research/shape-label/*`, the staged diff
(`git diff --cached`), `README.md`, `scripts/*`.

### Corpus basenames

Set derived, never hand-typed, from `jq -r '.[].path' test/corpus.local.json`
piped through `basename`, deduplicated: **6 basenames**.

- **Positive control:** `grep -c -F -f <set> test/corpus.local.json` → **10**
  hits (non-zero, so the sweep can find things).
- Five of the six basenames: **0 hits** in every target.
- The sixth is the 6-letter basename the plan flags: an exact
  case-insensitive match in `/usr/share/dict/words`, and `git grep -l` at
  `89448e7` over `feature-research/*` finds it in **42** record files — the
  precedent count the plan states. Its hits here are 3 in the plan directory,
  6 in the staged diff, 6 in `README.md` (a case-insensitive sweep counts 6,
  not 5 — one of the six is a CamelCase identifier in prose), 0 in
  `scripts/`. Every one was inspected with the word masked: all are the
  ordinary English/domain word in
  project prose, or the hermetic fixture's own directory name inside
  `test/fixtures/mini-fullstack-csharp/…`. Classified as noise per the plan's
  rule (dictionary word + 42-file precedent). **0 genuine hits.**

### Host / token

- Pattern file written under `umask 077` (mode 600) in the scratchpad from
  `~/.config/psq/deploy.env` via
  `grep -E '^(export )?PSQ_(HOST|TOKEN)=' | cut -d= -f2-` with quotes stripped
  — **2 pattern lines**. The values never entered a shell variable or argv.
- **Positive control:** `grep -c -F -f <patterns> ~/.config/psq/deploy.env` → **2**.
- `feature-research/shape-label/` → **0**; staged diff → **0**; `README.md` →
  **0**; `scripts/` → **0**.
- Pattern file deleted afterwards (existence re-checked: gone).

## Open risks

- `repoAClient` still exits 1 on its one `not-a-member` graded-wrong finding.
  Expected and recorded (D-C-7); it is a wrong reference answer, not an
  ambiguous prompt, and belongs to a different phase.
- `rationale` on `optionalField`, `collectionField` and `discriminator` still
  names the bare shape name (D-C-2). It is always displayed beside the now
  labelled prompt, so the question as a whole is unambiguous, but a future
  consumer that renders rationale alone would be ambiguous again.
- The two drift sites (`ds.drift.*`) keep bare prompts and file-less ids
  (D-C-3). Unreachable today; when reached, selftest reports a duplicate id.
- The live `com.psq.server` still runs the pre-change code. Deploy is a
  separate step after review (D-C-8); nothing was restarted or redeployed.
- `pnpm test:e2e` was not run (D-C-10). The e2e fixtures are `mini-efcore`
  (0 shapes) and `mini-node` (12 shapes, 0 duplicated names), so their banks
  are provably byte-identical under this change.

## Deviations

None. Every step, gate and constraint in the plan was followed as written; the
six touched paths are exactly the plan's table, all measured baselines matched
the plan's tables, and all required gate values were met.
