# Audit — demo-harden-drift-pin

## Files changed

*Round 0 (committed as `c9793e6` + `7eb95a3`):*

1. `test/web-schema-drift.test.ts` — NEW, 111 lines.
2. `feature-research/demo-harden-drift-pin/audit.md` — NEW, this file.

*Round 1 (review fixes, uncommitted working tree on top of `7eb95a3`):*

1. `test/web-schema-drift.test.ts` — MODIFIED, now 155 lines.
2. `feature-research/demo-harden-drift-pin/audit.md` — MODIFIED, this file.
3. `feature-research/demo-harden-drift-pin/plan.md` — NEW.

*Round 2 (review verdict **Ship**, two non-blocking items; still uncommitted on
top of `7eb95a3`):*

1. `test/web-schema-drift.test.ts` — MODIFIED, now **179 lines**. Adds the
   declaration-merging guard (`markerCount`).
2. `feature-research/demo-harden-drift-pin/audit.md` — MODIFIED, this file.
3. `feature-research/demo-harden-drift-pin/plan.md` — MODIFIED.

Same three paths in all three rounds. No production code was changed. No file
under `apps/web`, `apps/server` or `packages/*` is modified in the final tree (mutants were applied and reverted;
see the revert proof below).

---

## What was built

A drift pin between the wire schema (`EntityGraph` in `@psq/schema`,
`packages/schema/src/index.ts:344`) and the hand-written client mirror
(`export interface EntityGraph` at `apps/web/src/lib/api.ts:126`).

The file lives in the **root** `test/` directory, not in `apps/web`. That app
takes no workspace dependencies on purpose (comment at
`apps/web/src/lib/api.ts:33-34`), so the root suite is the only place that can
import `@psq/schema` and still read `api.ts` as text without violating that
rule. `api.ts` is read with `readFileSync` and parsed — it is never imported as
a module.

### Plan claims verified before writing (all three held)

| Claim | Measured |
|---|---|
| web mirror declares 8 fields | 8: `repo, provider, contextName, entities, relations, warnings, clientCalls, components` |
| `@psq/schema` `EntityGraph` declares 12 | 12: the 8 above plus `kind, shapes, routes, entityRefs` |
| gap is exactly `entityRefs, kind, routes, shapes` | confirmed |

No discrepancy to report; the plan did not need adjusting.

### Content decisions

- **The 4-field gap is an explicit allowlist** (`NOT_MIRRORED`), not a
  "should be identical" pin. The gate reddens when the gap widens *or*
  narrows; narrowing it requires deliberately shrinking the allowlist.
- **`SCHEMA_FIELDS` and `WEB_FIELDS` are pinned literal lists**, sorted, and
  compared with `toEqual`. A pinned list (not a count) means a *rename* also
  reddens, which a length check would miss.
- **The `toContain("entities")` clause is a DIAGNOSTIC AID, not the detection
  mechanism, and it is not a gate at all.** (Corrected in review round 1; round 0
  called it "the positive control" and that rationale was wrong. **Corrected
  again in round 2**: the round-1 text then claimed it "is also the clause that
  stops the anti-silent-drop guard from passing vacuously". That was false in
  exactly the way the round-0 claim was false, and is withdrawn — see below.)
  `expect(webFields).toEqual(WEB_FIELDS)` compares against an 8-element pinned
  list, so it *already* fails on an empty parse; `toContain` can never be the
  thing that catches a no-match. Measured on the round-2 file: under M8 the
  failure lands at `test/web-schema-drift.test.ts:164` (the `toContain`), under
  M3 and M4 at `:165` (the `toEqual`). The clause is kept for its **message**:
  "expected [] to include 'entities'" reads as an empty parse, where `:165`'s
  diff reads as a list carrying an extra name. That is what tells an empty parse
  apart from a deliberately mirrored field.
- **What `:164` does NOT do — the withdrawn round-1 claim, stated honestly.**
  The anti-silent-drop guard at `:156` passes vacuously on a zero-segment body,
  and it is paired with **two** clauses that each fail on an empty parse:
  `:164`'s `toContain("entities")` and `:165`'s `toEqual` against the 8-element
  `WEB_FIELDS`. `:164` merely **runs first**; it is not what makes the zero case
  red. **The consequence, named explicitly: deleting `:164` would not move any
  gate.** It would only degrade a failure message — M8 would still redden, at
  `:165` instead. This repo's standing lesson is that a second correct guard
  makes breakage *harder* to detect, so `:164` is labelled here as what it is:
  **documentation and a message aid, not a gate**, and it is not counted in any
  detection claim in this file. The test's own comment block at
  `test/web-schema-drift.test.ts:157-163` already words this correctly; this
  bullet was brought into line with that comment, not the other way round.
- **The marker-count clause at `test/web-schema-drift.test.ts:151` is a real
  gate, added in round 2.** `parseWebEntityGraphFields` reads only
  `source.indexOf(MARKER)` — the FIRST declaration — but TypeScript **merges**
  interface declarations, so a second `export interface EntityGraph { kind:
  "entity"; }` block anywhere in the file puts `kind` genuinely on the type
  while the parse still reports the original 8 fields and every assertion stays
  green. That is the same defeat class as the round-1 blocking finding, on a
  different axis. The clause asserts the marker occurs **exactly once**
  (`source.split(MARKER).length - 1`), which covers both directions: more than
  one is a merged second declaration, zero is a rename or reformat out of the
  matcher's reach. Gated by **M9** (second declaration) and **M10** (rename →
  zero markers).
  - *Declaration merging was verified, not assumed, and with a positive
    control.* With the second block appended plus a probe
    `const __probeK: EntityGraph["kind"] = "entity";`,
    `pnpm --filter @psq/web typecheck` exits **0**. With the probe alone and no
    second block it exits **2**:
    `src/lib/api.ts(286,29): error TS2339: Property 'kind' does not exist on
    type 'EntityGraph'.` The merged member is real, and the control proves the
    probe can fail.
- The parser strips block and line comments before splitting on `;`, so a
  commented-out field is not counted as declared.
- One typecheck-driven edit was needed after the first suite run: `m[1]` is
  `string | undefined` under this repo's `noUncheckedIndexedAccess`, so the
  push is guarded with `m?.[1]`. **Every number below was re-measured after
  that edit**; nothing is carried forward across it.

### Final line cites (RE-DERIVED in round 2, against the round-2 file)

Round 0's cites (`:68`, `:89, 93, 100, 107`, for the 111-line file) and round
1's (`:97, 100, 123, 127, 132, 140, 141, 144, 151`, for the 155-line file) are
both **stale**: inserting the marker-count guard moved everything from `:104`
down. The file is now **179 lines**. Every cite below was re-derived after the
final edit, including the ones in sections this round did not rewrite:

- `test/web-schema-drift.test.ts:104` — `parseWebEntityGraphFields`
- `test/web-schema-drift.test.ts:105` — `source.split(MARKER).length - 1`, the
  marker count
- `test/web-schema-drift.test.ts:108` — `source.indexOf("}", open)`, the
  brace-depth-naive body end (see known limitations)
- `test/web-schema-drift.test.ts:130, 134, 168, 175` — the four `it(...)` blocks
- `test/web-schema-drift.test.ts:131` — assertion 1's `toEqual(SCHEMA_FIELDS)`
- `test/web-schema-drift.test.ts:151` — `.toBe(1)` on `markerCount`, the round-2
  **declaration-merging guard** (the `expect(` opens at `:143`; vitest cites the
  matcher line, `:151`)
- `test/web-schema-drift.test.ts:156` — `expect(unparsed).toEqual([])`, the
  round-1 anti-silent-drop guard
- `test/web-schema-drift.test.ts:164` — `expect(webFields).toContain("entities")`
  (a message aid, not a gate — see above)
- `test/web-schema-drift.test.ts:165` — `expect(webFields).toEqual(WEB_FIELDS)`
- `test/web-schema-drift.test.ts:172` — assertion 3's `toEqual(NOT_MIRRORED)`
- `test/web-schema-drift.test.ts:177` — assertion 4's `toEqual([])`
- `apps/web/src/lib/api.ts:126` — the mirrored interface (unchanged; `api.ts` was
  not edited, so its cites did not move)
- `apps/web/src/lib/api.ts:33-34` — the zero-workspace-deps comment
- `packages/schema/src/index.ts:344` — `export const EntityGraph = z.object({`

---

## Measured numbers (each labelled with the command that produced it)

All commands run from the repo root under
`zsh -lc` with fnm's node v24.19.0 prepended to `PATH`.

| Command | Result |
|---|---|
| `pnpm test` (BASELINE, before the new file) | **35 test files passed, 460 tests passed** |
| `pnpm test` (FINAL, after the typecheck fix) | **36 test files passed, 464 tests passed** |
| `pnpm typecheck` (first attempt) | **exit 2** — `test/web-schema-drift.test.ts(81,24): error TS2345: Argument of type 'string \| undefined' is not assignable to parameter of type 'string'` |
| `pnpm typecheck` (after the `m?.[1]` fix) | **exit 0** |
| `PSQ_NO_CORPUS=1 pnpm test` | **33 passed \| 3 skipped (36 files); 406 passed \| 58 skipped (464 tests)** — skipped is exactly 58, the required number |
| `pnpm exec vitest run --config vitest.e2e.config.ts` | **1 file passed, 23 tests passed**, 30.62s |
| **ROUND 1** `pnpm typecheck` | **exit 0** |
| **ROUND 1** `pnpm test` | **36 test files passed, 464 tests passed** (unchanged — the round-1 guard is a clause inside assertion 2, not a fifth test) |
| **ROUND 1** `PSQ_NO_CORPUS=1 pnpm test` | **33 passed \| 3 skipped (36 files); 406 passed \| 58 skipped (464 tests)** — skipped is exactly 58 |
| **ROUND 1** e2e | **NOT RE-RUN.** Nothing in round 1 touches the e2e path (one root-suite test file plus two record files; no production code, no bundle). The round-0 e2e result stands and is not re-claimed. |
| **ROUND 2** `pnpm typecheck` | **exit 0** |
| **ROUND 2** `pnpm test` | **36 test files passed, 464 tests passed** (unchanged — the round-2 guard is a clause inside assertion 2, not a fifth test) |
| **ROUND 2** `PSQ_NO_CORPUS=1 pnpm test` | **33 passed \| 3 skipped (36 files); 406 passed \| 58 skipped (464 tests)** — skipped is exactly 58 |
| **ROUND 2** e2e | **NOT RE-RUN, and not re-claimed.** `pnpm test:e2e` is prohibited (it front-runs `build:web`), and the direct-config invocation was not run either. Round 2 changes one root-suite test file and two `feature-research` documents; no production code, no bundle. |

### 35 → 36 collection proof

The root glob in `vitest.config.ts` is
`["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "test/**/*.test.ts"]`,
so the new file is picked up by the third pattern. Proven empirically, not
inferred:

- files: **35 → 36** (+1)
- tests: **460 → 464** (+4), exactly the four tests written

The gate is collected and running. It is not a dead artifact.

### e2e safety

`pnpm test:e2e` was **never run** (it front-runs `build:web`, which would empty
the live `apps/web/dist`). The e2e suite was invoked directly against the
existing bundle via `pnpm exec vitest run --config vitest.e2e.config.ts`.
`apps/web/dist` was fingerprinted before and after:

Round 0 recorded an aggregate digest `8e830dd3…` **without stating the hashing
method**, and it is not reproducible: the reviewer's
`find … | sort | xargs shasum | shasum` over the same unchanged files gives a
different digest. Round 1 replaces it with per-file digests and the exact
command, re-measured on 2026-09-18 against the untouched `dist`:

```
$ find apps/web/dist -type f | sort | xargs shasum
6a8bde3f274b519ec91bbcd1a69ef8986dfa01ce  apps/web/dist/assets/index-DD80H-hn.css
47ba6e40e66dd79a7499062c44e09270b3807c2f  apps/web/dist/assets/index-u0cDFAtu.js
bc8a81bd687bdd31f1617df1b69f43001fb5fc68  apps/web/dist/index.html

$ find apps/web/dist -type f | sort | xargs shasum | shasum
2c3d4cf70f21b8c23576e8bb18bcf58ed10fa9bc  -
```

**The stronger proof is mtime, not a digest**: a digest only shows the bytes
match, while mtime shows nothing wrote the files at all.

```
$ find apps/web/dist -type f -newermt 2026-09-17 | wc -l
       0          # of 3 files total — nothing in dist has been written since
```

Unchanged. `pnpm build` and `pnpm build:web` were never run. No launchd
service was touched. Nothing was committed.

---

## Mutant table — failure sets recorded SUITE-WIDE

**This table was re-run from scratch in round 2, against the round-2 test file.
No row is carried forward from round 0 or round 1** — every row below, including
M1–M8 which round 1 had already measured, comes from a fresh `pnpm test` run
against the final file. Each mutant was applied to the real production file, the
**whole** suite was run, every reddened test in every package was recorded, and
the file was restored from a byte-identical backup taken before any mutation.
Baseline for every run: 36 files / 464 tests, all passing (re-confirmed on a
pristine control run after the sweep).

Cites are `test/web-schema-drift.test.ts:<line>` against the 179-line round-2
file.

| # | Mutant (all in `apps/web/src/lib/api.ts` unless noted) | Suite-wide failing tests | Clause that fired | Totals |
|---|---|---|---|---|
| **M1** | `packages/schema/src/index.ts`: add `mutantField: z.array(z.string()).default([])` to `EntityGraph` | assertions **1, 3** | `:131` (assertion 1), `:172` (assertion 3) | 2 failed / 462 passed; 1 file failed / 35 passed |
| **M2** | move the interface's opening brace to its own line (a pure reformat; the marker no longer matches) | assertions **2, 3** | **`:151` the round-2 marker-count guard** (round 1 recorded `:140` `toContain` here; the new clause runs first and names the cause) + `:172` | 2 failed / 462 passed; 1 file failed / 35 passed |
| **M3** | add `kind: "entity";` — mirror an allowlisted field | assertions **2, 3** | `:165` `toEqual(WEB_FIELDS)`, `:172` | 2 failed / 462 passed; 1 file failed / 35 passed |
| **M4** | add `phantomField: string;` — a field the server never sends | assertions **2, 4** | `:165` `toEqual(WEB_FIELDS)`, `:177` (assertion 4) | 2 failed / 462 passed; 1 file failed / 35 passed |
| **M5** | add `readonly kind: "entity";` | assertion **2 only** | **`:156` the round-1 guard** — `expected [ 'readonly kind: "entity"' ] to deeply equal []` | 1 failed / 463 passed; 1 file failed / 35 passed |
| **M6** | add `"kind": "entity";` (quoted key) | assertion **2 only** | **`:156` the round-1 guard** — `expected [ '"kind": "entity"' ] to deeply equal []` | 1 failed / 463 passed; 1 file failed / 35 passed |
| **M7** | add `readonly phantomField: string;` | assertion **2 only** | **`:156` the round-1 guard** — `expected [ 'readonly phantomField: string' ] to deeply equal []` | 1 failed / 463 passed; 1 file failed / 35 passed (see the flake note below) |
| **M8** | empty the interface body (`export interface EntityGraph {\n}`) — the zero-**segment** case; the marker is still present exactly once | assertions **2, 3** | `:164` `toContain` (the guard at `:156` passed VACUOUSLY; `:151` passed, correctly — one marker) + `:172` | 2 failed / 462 passed; 1 file failed / 35 passed |
| **M9** | **NEW in round 2.** Append a SECOND declaration at end of file: `export interface EntityGraph {\n  kind: "entity";\n}` | assertion **2 only** | **`:151` the round-2 marker-count guard** — `expected 2 to be 1` with the named message. Assertions 1, 3, 4 stay GREEN, which is the direct measurement that no pre-existing clause catches it | 1 failed / 463 passed; 1 file failed / 35 passed |
| **M10** | **NEW in round 2.** The zero-**marker** case: rename the interface to `EntityGraphRenamed` (and its one use site) so the marker occurs 0 times | assertions **2, 3** | **`:151`** — `expected 0 to be 1` + `:172` | 2 failed / 462 passed; 1 file failed / 35 passed |

All ten mutants reddened. None passed silently.

**M7 flake, recorded rather than smoothed over.** On the first M7 run the suite
reported 2 files / 2 tests failed: assertion 2 as expected, plus
`apps/server/test/api.test.ts > entity search > returns a parseable result that
names the fields it searched` with `Error: Test timed out in 5000ms`. That is a
timing flake, not a mutant effect — the server does not read `apps/web`. Two
clean re-runs of M7 each gave **1 failed / 463 passed, assertion 2 alone**, and
the pristine control run afterwards was 464/464 green. The row above records the
reproducible result; the one-off timeout is noted here so the discrepancy is not
silently dropped.

### M5, M6, M7 — the blocking finding, closed and gated

Before round 1 all three of these left **all four assertions green** (the
reviewer measured it: each parsed to 8 fields, because the unmatched segment was
dropped without trace). After round 1 each reddens, and each reddens **because
of the new guard** — not via a pre-existing assertion:

- The failure line is `test/web-schema-drift.test.ts:156`, which is
  `expect(unparsed).toEqual([])`, added in round 1.
- The failure set is assertion **2 alone**. Assertions 1, 3 and 4 stay green
  under all three, which is the direct measurement that no pre-existing
  assertion catches them.
- The message names the offending segment verbatim, e.g.
  `expected [ 'readonly phantomField: string' ] to deeply equal []`.

### M9, M10 — the round-2 finding, closed and gated

The round-2 review found one surviving defeat of the same class: a **second**
`export interface EntityGraph { kind: "entity"; }` block. TypeScript merges it
into the existing interface (verified with a positive control, above), so the
allowlisted `kind` really is on the type, while `parseWebEntityGraphFields` —
which only ever reads `source.indexOf(MARKER)` — still sees the original 8
fields. Before round 2 that left **all four assertions green**.

- **M9** (second declaration appended) now reddens at
  `test/web-schema-drift.test.ts:151`, the new `markerCount` clause, with
  `expected 2 to be 1` and a message that says a second declaration was found
  and that declaration merging means the parse is no longer authoritative.
- The M9 failure set is assertion **2 alone** — assertions 1, 3 and 4 stay
  green. That is the direct measurement that it reddens **via the new clause**
  and not incidentally via another assertion.
- **M10** covers the opposite direction of the same clause: the marker occurring
  **zero** times (interface renamed). It reddens at `:151` with
  `expected 0 to be 1`, plus assertion 3 at `:172`.

### The zero-marker case — verified, not assumed

The task asked whether the guard has a vacuity trap of its own when the marker
occurs zero times. It does not, and the case is loud in **two** places, measured:

- **Before round 2** the zero-marker case was already red: with no marker,
  `parseWebEntityGraphFields` returns `{ fields: [] }`, and assertion 2 failed
  at the `toContain`/`toEqual` pair while assertion 3 failed on the 12-vs-4
  diff. So the existing parse path did catch it — verified against M2 and M10,
  not assumed.
- **After round 2** the new clause at `:151` runs first and catches it with a
  better message (`expected 0 to be 1`, naming rename-or-reformat as the cause)
  instead of the downstream `expected [] to include 'entities'`. This is a
  measured change from round 1 for **M2** (was `:140` `toContain`, now `:151`)
  and for the doc-comment variant below; it is recorded rather than glossed.

### M8 — the unparsed guard cannot pass by finding nothing

A body with zero non-empty `;`-segments satisfies `unparsed == []` trivially, so
`0 == 0` had to be proven not to be a pass. Measured: under M8 the guard at
`:156` **passes vacuously** (and `:151` passes too, correctly — the marker is
still there exactly once), and assertion 2 still fails at `:164`,
`expected [] to include 'entities'`. Assertion 3 fails too. The zero-segment
case is red. **Note the honest scoping**, per the correction above: `:164` is
not what makes it red — `:165`'s `toEqual` against the 8-element list fails on
`[]` as well, so `:164` only runs first and supplies the clearer message.
Deleting `:164` would not move this gate. This mutant was added beyond the
round-1 review's ask, for exactly this reason.

### Parser tolerance and brittleness — measured, not assumed

Measured with a probe that replicates `parseWebEntityGraphFields` verbatim with
its TypeScript annotations stripped, run over synthetic variants of the
interface body (the probe lives in the scratch directory; it is not part of the
repo).

| Variant of the interface | fields | `unparsed` | Verdict |
|---|---|---|---|
| baseline (as shipped) | 8 | `[]` | green |
| fields reordered | 8 | `[]` | TOLERANT |
| one field per line | 8 | `[]` | TOLERANT |
| line comments in the body | 8 | `[]` | TOLERANT |
| JSDoc block in the body | 8 | `[]` | TOLERANT |
| multi-line union type | 8 | `[]` | TOLERANT |
| `?:` optional field | 8 | `[]` | TOLERANT |
| missing final semicolon | 8 | `[]` | TOLERANT |
| opening brace on its own line | 0 | `[]` | **FALSE RED** (marker not found) |
| **two** spaces before the brace | 0 | `[]` | **FALSE RED** (marker not found) |
| commas instead of semicolons as separators (valid TS) | 1 | `[]` | **FALSE RED** — the whole body is one `;`-segment, only the first member parses, and the round-1 guard does **not** catch it |
| nested object literal type (`repo: { name: string; url: string }`) | 2 (`repo`, `url`) | `[]` | **WRONG BUT RED** — `source.indexOf("}", open)` at `test/web-schema-drift.test.ts:108` is brace-depth-naive and truncates the body at the inner `}` |
| a method signature (`components(): UiComponent[]`) | 7 | `['components(): UiComponent[]']` | **RED** — the round-1 disagreement, adjudicated in round 2; see below |

**The round-1 disagreement, adjudicated.** The round-1 review listed "a method
signature" among the cases that are *tolerant* and *parse correctly to 8*. The
implementer disagreed and recorded 7. **Round 2 adjudicated that row as FALSE
and confirmed the implementer's disagreement was correct**: it parses to 7.
Re-measured in round 2 as a full suite run rather than a probe (variant V6,
`components(): UiComponent[];` replacing the `components` field):
`components(): UiComponent[]` does not match
`^\s*([A-Za-z_$][\w$]*)\s*\??\s*:` — the `(` intervenes — so it lands in
`unparsed`, leaving 7 fields. Suite-wide failure set **{2, 3}**:
`test/web-schema-drift.test.ts:156` (`expected [ 'components(): UiComponent[]' ]
to deeply equal []`) and `:172` (assertion 3 gains `components` in the
schema-only set). 2 failed / 462 passed. Recorded as a record-accuracy fact, not
a complaint. The rest of the round-1 review's tolerance and brittleness list
reproduced exactly.

### Round-2 defeat attempts — all measured suite-wide against the final file

The round-2 review tried five further ways to defeat the gate and one it
expected to be tolerated. All six were **re-measured here as full `pnpm test`
runs** against the 179-line file (the round-1 numbers for these came from a
probe and from the pre-guard file, so none is carried forward):

| Variant applied to `apps/web/src/lib/api.ts` | Failing assertions | Cites | Totals |
|---|---|---|---|
| index signature `[key: string]: unknown;` | **2** | `:156` — `expected [ '[key: string]: unknown' ] to deeply equal []` | 1 failed / 463 passed |
| a modifier on its own line before the name (`readonly\n  kind: "entity";`) | **2** | `:156` — `expected [ 'readonly\n  kind: "entity"' ] to deeply equal []` | 1 failed / 463 passed |
| a `;` inside a string literal type (`sep: "a;b";`) | **2, 4** | `:156` (`expected [ 'b"' ]`) and `:177` (`expected [ 'sep' ] to deeply equal []`) | 2 failed / 462 passed |
| an `extends` form (`export interface EntityGraph extends Record<string, unknown> {`) | **2, 3** | **`:151`** — `expected 0 to be 1` (round 1 had this at `:132` + `:148`; the marker-count clause now fires first and names the cause) + `:172` | 2 failed / 462 passed |
| the marker string duplicated inside a doc comment ABOVE the real interface | **2, 3** | **`:151`** — `expected 2 to be 1` (round 1 had this at `:132` + `:148`) + `:172` | 2 failed / 462 passed |
| a method signature (`components(): UiComponent[];`) | **2, 3** | `:156` + `:172` | 2 failed / 462 passed |
| a trailing comment-only segment | *none* — **correctly TOLERATED** | comments are stripped at `:113-114`, the segment is then empty and skipped | 36 files / 464 tests, all green |

The duplicated-marker-in-a-doc-comment row is worth naming: it is a **false
positive** of the new clause — a comment is not a declaration — but it is a
false RED, not a false green, and it was already red before round 2 on two other
clauses. The trade is the same one this file makes everywhere: a literal string
match, deliberately brittle, in a repo with no formatter that could trip it.

The repo carries no prettier, biome, eslint or editorconfig configuration, so
nothing will reformat `api.ts` spontaneously and trip a false red. The trade is
accepted deliberately — and now written down, in both the audit and the test's
own comment block.

### Facts worth naming from the table (RE-DERIVED over M1–M10 in round 2)

- **Nothing outside this file catches any of the ten mutants.** Every failure
  set is entirely within `test/web-schema-drift.test.ts`; the other 35 files
  stayed green in all ten runs (the single `apps/server` timeout under the first
  M7 run did not reproduce — see the flake note). M1 — a new wire-schema field
  the client never learns about — was previously caught by **zero** tests. That
  is the gap this file closes, measured rather than argued.
- **Round 0's claim "assertions 1 and 4 each have a mutant that only they catch"
  was FALSE and is withdrawn.** Measured failure sets were M1 {1,3}, M2 {2,3},
  M3 {2,3}, M4 {2,4} — assertion 1 never fired alone, and assertion 4 never
  fired alone. No assertion had a mutant only it caught.
- **Re-derived over M1–M10, exactly one assertion has mutants only it catches:
  assertion 2** — via M5, M6, M7 (the round-1 `unparsed` guard) and **M9** (the
  round-2 `markerCount` guard), {2} each. Assertion 1 still never fires alone
  (M1 is {1,3}).
- **Full re-derived failure sets:** M1 {1,3}, M2 {2,3}, M3 {2,3}, M4 {2,4},
  M5 {2}, M6 {2}, M7 {2}, M8 {2,3}, M9 {2}, M10 {2,3}.
- **Which clauses are gates, and which are not.** Gates, each with a mutant that
  reddens *because of it*: `:131` (M1), `:151` (M9, M10), `:156` (M5, M6, M7),
  `:165` (M3, M4). Not gates: `:164` (`toContain`) — every case that reddens
  there also fails `:165`, so deleting it moves nothing and only degrades a
  message; and assertions 3 (`:172`) and 4 (`:177`), for the reason below.
  Labelling these as documentation rather than counting them as detection is the
  point of this section.
- **Assertions 3 and 4 cannot fail alone, and add zero detection power over
  1 ∧ 2.** They are logically implied: if assertion 1 passes then the schema key
  set is exactly `SCHEMA_FIELDS`, and if assertion 2 passes then `webFields` is
  exactly `WEB_FIELDS`, which fixes both `schema − web` and `web − schema` to
  constants. Their value is as **executable documentation of the allowlist** —
  they state, in the suite, which four fields are deliberately not mirrored and
  that nothing is mirrored that the server never sends. That is worth keeping;
  it is not extra detection, and round 0 implied it was.
- **M2, M3, M8 and M10 share the failure set {2,3}** but are four different
  facts — the marker was reformatted away (M2), a field was deliberately
  mirrored (M3), the body is empty (M8), the interface was renamed (M10).
  Assertion 3 cannot tell them apart; assertion 2's *message* can, and after
  round 2 it does so better: M2 and M10 now name the marker count at `:151`
  instead of surfacing as "expected [] to include 'entities'". That is the
  justification for keeping the `toContain` clause — a message, not detection.
- **M3's effect on assertion 2 is by design**, not a flaw: mirroring a new field
  in the client is supposed to require an intentional edit to both pinned lists.

### Revert proof

Backups were taken before any mutation; the files after the last revert of the
round-2 sweep (M1–M10 plus the seven round-2 variants plus the two
declaration-merging typecheck probes — every one applied to the real production
file and reverted from a byte-identical backup):

```
$ shasum apps/web/src/lib/api.ts packages/schema/src/index.ts
ad33b11e9b12d9a4a489be0c56aafc64bf02646a  apps/web/src/lib/api.ts
5ae8071d6e4bbf63c12613dd82726f4f71ef280e  packages/schema/src/index.ts
```

Both match their pre-mutation shasums exactly, and both match the round-0 and
round-1 figures. No mutant, variant or probe leaked. A pristine control `pnpm
test` run after the sweep returned **36 files / 464 tests, all passing**, which
is the behavioural half of the same proof.

### Final `git status --porcelain -uall` (round 2)

Captured after the last mutant revert and after this audit and `plan.md` were
written. A `git diff --stat` line is deliberately NOT quoted here: recording it
in this file changes it, so the number would be stale the moment it was written.
The stable facts are the status entries and the absence of any production path.

```
$ git status --porcelain -uall
 M feature-research/demo-harden-drift-pin/audit.md
 M test/web-schema-drift.test.ts
?? feature-research/demo-harden-drift-pin/plan.md

$ git status --porcelain -uall | grep -cE '^.. (apps|packages)/'
0          # no production path is modified

$ git log --oneline -1
7eb95a3 docs: demo-harden audit — the drift pin, its mutants, and the e2e run
```

Exactly the three expected entries: one test file, two record files. **No
production file is modified** — no `apps/web`, no `apps/server`, no
`packages/*` path appears. `HEAD` is unchanged at `7eb95a3`; rounds 1 and 2 are
uncommitted and unstaged, and neither existing commit was amended or rewritten.
Re-captured in round 2 after the last revert and after both record files were
written; identical to the round-1 capture.

---

## Deviations from the plan

*Round 0.* One, and it is mechanical rather than scope-related: the plan's verification
step named `vitest run --config vitest.e2e.config.ts`; it was invoked as
`pnpm exec vitest run --config vitest.e2e.config.ts` because `vitest` is not on
`PATH` directly. Same config, same 23 tests, and — as the plan required —
without `build:web`.

No other deviation. No production code touched, no new e2e tests, no changes
outside the two files listed at the top.

*Round 1.* Two, both inside the review's own instructions:

1. The review asked for M5–M7. **M8 was added** as well, because the review also
   required proof that the new guard cannot pass by finding nothing, and a
   zero-segment body is that case. It is a mutant, so it belongs in the table.
2. The review's verification list did not include e2e, and **e2e was not
   re-run**. Nothing in round 1 can affect it: the changes are one root-suite
   test file and two `feature-research` documents. This is stated rather than
   implied.

`plan.md` did not exist in round 0 and is written now (review item E). It
reproduces the approved plan verbatim, is marked as the approved rev, and was
not edited to match what was built.

*Round 2.* Two, both inside the review's own instructions:

1. The review asked for **M9**. **M10 was added** as well — the zero-marker
   direction of the same clause — because the review also asked whether the new
   guard has a vacuity trap when the marker occurs zero times. M2 already covers
   that incidentally (a reformat loses the marker), but M10 is the clean,
   deliberate case, so it belongs in the table alongside M9.
2. The review's verification list did not include e2e, and **e2e was not run —
   neither `pnpm test:e2e` (prohibited) nor the direct-config invocation**.
   Nothing in round 2 can affect it: the changes are one root-suite test file
   and two `feature-research` documents. This is stated rather than implied.

One thing the review did not ask for and is recorded anyway: the round-1 clause
cites for M2 and for two of the round-2 variants **changed**, because the new
`markerCount` clause runs before `toContain` and fires first on any marker-count
anomaly. Those rows are re-measured above rather than carried forward.

---

## Open risks and NOT MEASURED

### Known limitations of the parse (both directions)

- **FALSE RED direction — the parse is intentionally brittle.**
  `parseWebEntityGraphFields` matches the literal string
  `export interface EntityGraph {`, so the marker is lost to a harmless
  reformat. Measured false reds: the opening brace moved to its own line; **two**
  spaces before the brace (`EntityGraph  {`); commas used instead of semicolons
  as member separators, which is valid TS and leaves the whole body as one
  `;`-segment so only the first member parses. A nested object literal type is a
  separate, *wrong-but-red* case: `source.indexOf("}", open)` at
  `test/web-schema-drift.test.ts:108` is brace-depth-naive, so
  `repo: { name: string; url: string }` truncates the body at the inner `}` and
  yields `["repo","url"]`. The repo has no prettier/biome/eslint/editorconfig,
  so nothing reformats `api.ts` spontaneously; the trade is accepted, and the
  full tolerance table is in the mutant section above.
- **SILENT-DROP direction — closed in round 1, named here because round 0 did
  not name it at all.** Round 0's parser dropped any `;`-segment whose first
  token was not the identifier, with no trace, so `readonly kind: "entity";`,
  `"kind": "entity";` and `readonly phantomField: string;` each parsed to 8
  fields and left **all four assertions green** — the first two defeating the
  "gap narrows" direction, the third defeating assertion 4. The `unparsed`
  guard at `test/web-schema-drift.test.ts:156` closes this, gated by M5–M7.
  **Round 2 narrowed what is unmeasured here.** Five further member/declaration
  syntaxes were tried as full suite runs and every one is **RED**: an index
  signature (`:156`), a modifier on its own line before the name (`:156`), a `;`
  inside a string literal type (`:156` + `:177`), an `extends` form (`:151` +
  `:172`), and the marker string duplicated in a doc comment above the real
  interface (`:151` + `:172`). A trailing comment-only segment is correctly
  **TOLERATED** (stripped at `:113-114`, then skipped): green, and that is the
  intended behaviour, not a gap. The method-signature case is red at `:156` +
  `:172` and parses to **7**, not 8. What remains **NOT MEASURED** is only this:
  whether some member syntax not on that list parses to a *wrong name* rather
  than landing in `unparsed`. The commas case and the nested-object case above
  are the two known ones, and both are red for the wrong reason rather than
  silent; there may be more.
- **DECLARATION-MERGING direction — a different axis from member syntax, opened
  and CLOSED in round 2.** Round 1's open-risk note named only member *syntax*.
  A second `export interface EntityGraph { ... }` block is not a syntax
  variation at all: the first declaration is parsed perfectly, and the extra
  members simply live somewhere the parse never looks. TypeScript merges them
  onto the same type (verified with a positive control above), so before round 2
  a second block could mirror an allowlisted field with **all four assertions
  green** — the same defeat class as the round-1 blocking finding. The
  `markerCount` clause at `test/web-schema-drift.test.ts:151` closes it in both
  directions, gated by **M9** (two markers) and **M10** (zero markers). This
  axis is now **closed**. **NOT MEASURED** on it: whether a merged declaration
  could arrive from a *different file* — TypeScript merges only within a module,
  and `api.ts` is a module, so a same-name interface in another file cannot
  merge into it; that reasoning was not converted into a mutant, so it is
  recorded as an argument, not a measurement. Also not measured: `declare module`
  augmentation of `api.ts` from elsewhere in `apps/web`.

### Scope

- **The pin covers `EntityGraph` only.** `api.ts` hand-mirrors these other
  server shapes, and **none of them is pinned**: `Layout` (`:29`),
  `Layout3DNode` (`:36`), `Entity` (`:97`), `Relation` (`:101`), `ClientCall`
  (`:106`), `UiComponent` (`:123`), `ShapeField` (`:132`), `Drift` (`:136`),
  `Shape` (`:142`), `Route` (`:151`). This matters more than a bare coverage
  note: `Route` and `Shape` are **two of the four allowlisted `NOT_MIRRORED`
  fields**, so whoever mirrors `routes` or `shapes` will be writing a brand-new
  unpinned interface at the same moment they shrink `NOT_MIRRORED`. The gate
  will make them edit the allowlist deliberately; it will do nothing about the
  new unpinned mirror they just added. NOT MEASURED: how far any of these have
  already drifted.
- **The pin is structural, not semantic.** It compares field *names*. A field
  whose type diverges (schema `string[]` vs. client `string`) still passes.
  `call<T>()` remains `return body as T` with no runtime validation; this file
  does not change that, it only makes name-level divergence loud.
- **NOT MEASURED**: whether the three `PSQ_NO_CORPUS=1`-skipped files are the
  same three as before this change. Only the aggregate skip count (58, the
  required figure) was checked, in both rounds. The new file contains no
  corpus-gated tests, so it cannot have contributed to that count.
- **NOT MEASURED**: `pnpm build` / `pnpm build:web` behaviour — deliberately
  never run, per the hard prohibition. The typecheck gate (`tsc --noEmit` across
  four projects) passed in both rounds, so the file compiles, but no bundle was
  produced or verified.
- **NOT RE-RUN in round 1 or round 2**: the e2e suite. See the deviations
  section. Round 0's direct-config run is the only e2e measurement in this
  record, and it is not re-claimed for later rounds.

### Record-accuracy corrections made in round 2

Kept factual and brief; these are record facts, not complaints.

- The round-1 review's tolerance row "a method signature is tolerant, parses to
  8" was **adjudicated FALSE in round 2**: it parses to **7**. The reviewer
  confirmed the implementer's round-1 disagreement was correct. Re-measured in
  round 2 as a full suite run: failure set {2, 3}.
- The round-1 audit's claim that `:164`'s `toContain` "is also the clause that
  stops the anti-silent-drop guard from passing vacuously" was **false and is
  withdrawn**, for the same reason round 0's "positive control" claim was false:
  `:165`'s `toEqual` against an 8-element pinned list also fails on `[]`, so
  `:164` merely runs first. `:164` is now labelled documentation, not a gate,
  and deleting it would not move any gate.
- All `file:line` cites in this file and in `plan.md` were re-derived against the
  final 179-line test file. No number or row in the mutant table was carried
  forward from an earlier round.
