# Audit — demo-harden-drift-pin

## Files changed

1. `test/web-schema-drift.test.ts` — NEW (untracked), 111 lines.
2. `feature-research/demo-harden-drift-pin/audit.md` — NEW (untracked), this file.

No production code was changed. No file under `apps/web`, `apps/server` or
`packages/*` is modified in the final tree (mutants were applied and reverted;
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
- **Positive control**: assertion 2 asserts `webFields` **contains
  `entities`** before comparing to the pinned list. The parse is deliberately
  narrow (it matches the exact string `export interface EntityGraph {`), so a
  rename or reformat makes it return `[]`. Without the contains-clause a
  subset-style gate would pass on an empty parse. M2 below is the mutant that
  exercises exactly this.
- The parser strips block and line comments before splitting on `;`, so a
  commented-out field is not counted as declared.
- One typecheck-driven edit was needed after the first suite run: `m[1]` is
  `string | undefined` under this repo's `noUncheckedIndexedAccess`, so the
  push is guarded with `m?.[1]`. **Every number below was re-measured after
  that edit**; nothing is carried forward across it.

### Final line cites (re-measured after the last edit)

- `test/web-schema-drift.test.ts:68` — `parseWebEntityGraphFields`
- `test/web-schema-drift.test.ts:89, 93, 100, 107` — the four `it(...)` blocks
- `apps/web/src/lib/api.ts:126` — the mirrored interface
- `packages/schema/src/index.ts:344` — the zod schema

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

```
before: 3 files, aggregate shasum 8e830dd39a76217d0279e7c2e7ce9b22f528fdb5
after:  3 files, aggregate shasum 8e830dd39a76217d0279e7c2e7ce9b22f528fdb5
```

Unchanged. `pnpm build` and `pnpm build:web` were never run. No launchd
service was touched. Nothing was committed.

---

## Mutant table — failure sets recorded SUITE-WIDE

Each mutant was applied to the real production file, the **whole** `pnpm test`
suite was run, and every reddened test in every package was recorded. Then the
file was restored from a byte-identical backup taken before any mutation.

| # | Mutant | Suite-wide failing tests | Totals |
|---|---|---|---|
| **M1** | `packages/schema/src/index.ts`: add `mutantField: z.array(z.string()).default([])` to `EntityGraph` | `test/web-schema-drift.test.ts > … > 1. @psq/schema EntityGraph declares exactly the pinned field set`<br>`test/web-schema-drift.test.ts > … > 3. the fields the client does not mirror are exactly the known four` | 2 failed / 462 passed, 1 file failed / 35 passed |
| **M2** | `apps/web/src/lib/api.ts`: move the interface's opening brace to its own line (a pure reformat — the parse then matches nothing) | `… > 2. the web client's hand-written interface parses to the pinned field set`<br>`… > 3. the fields the client does not mirror are exactly the known four` | 2 failed / 462 passed |
| **M3** | `apps/web/src/lib/api.ts`: mirror one of the four allowlisted fields — add `kind: "entity";` to the interface | `… > 2. the web client's hand-written interface parses to the pinned field set`<br>`… > 3. the fields the client does not mirror are exactly the known four` | 2 failed / 462 passed |
| **M4** | `apps/web/src/lib/api.ts`: add `phantomField: string;` — a field the server never sends | `… > 2. the web client's hand-written interface parses to the pinned field set`<br>`… > 4. the client mirrors no field the server never sends` | 2 failed / 462 passed |

All four mutants reddened something. None passed silently.

### Facts worth naming from the table

- **Nothing outside this new file catches any of the four mutants.** Every
  mutant's failure set is entirely within `test/web-schema-drift.test.ts`; the
  other 35 files stayed green in all four runs. In particular M1 — adding a
  field to the wire schema that the client never learns about — was previously
  caught by **zero** tests. That is the gap this file closes, measured rather
  than argued.
- **Each mutant's failure set is distinct**, so the four assertions are not
  redundant with one another: M1 hits {1,3}, M2 hits {2,3}, M3 hits {2,3},
  M4 hits {2,4}. Assertions 1 and 4 each have a mutant that only they catch.
- **M2 and M3 produce the same failure set** ({2,3}). They are still distinct
  facts — M2 is the parse-broke case, M3 is the deliberate-mirroring case —
  but assertion 3 alone cannot tell them apart; assertion 2's *message*
  (empty list vs. a list with an extra name) is what distinguishes them.
- M3's expected-by-design effect on assertion 2 is not a flaw: mirroring a new
  field in the client is supposed to require an intentional edit to **both**
  pinned lists.

### Revert proof

Backups taken before any mutation, and the files after the last revert:

```
5ae8071d6e4bbf63c12613dd82726f4f71ef280e  packages/schema/src/index.ts   (pre-mutation and final)
ad33b11e9b12d9a4a489be0c56aafc64bf02646a  apps/web/src/lib/api.ts        (pre-mutation and final)
```

Both match their pre-mutation shasums exactly. No mutant leaked.

### Final `git status --porcelain`

`git status --porcelain` captured after the last mutant revert, before this
audit file existed:

```
?? test/web-schema-drift.test.ts
```

`git status --porcelain -uall` captured after writing this audit (`-uall`
because plain `--porcelain` collapses a wholly-untracked directory to one
entry):

```
?? feature-research/demo-harden-drift-pin/audit.md
?? test/web-schema-drift.test.ts
```

Exactly the two expected entries. No tracked file is modified. `git log
--oneline -1` is still `56a186c`; nothing was committed or staged.

---

## Deviations from the plan

One, and it is mechanical rather than scope-related: the plan's verification
step named `vitest run --config vitest.e2e.config.ts`; it was invoked as
`pnpm exec vitest run --config vitest.e2e.config.ts` because `vitest` is not on
`PATH` directly. Same config, same 23 tests, and — as the plan required —
without `build:web`.

No other deviation. No production code touched, no new e2e tests, no changes
outside the two files listed at the top.

---

## Open risks and NOT MEASURED

- **The parse is intentionally brittle.** `parseWebEntityGraphFields` matches
  the literal string `export interface EntityGraph {`. A harmless reformat of
  that one line (prettier settings, a brace move) reddens the gate. That is by
  design — a silent no-match is the one failure mode that would let the gate
  pass while testing nothing — but it means a formatting-only change can
  produce a red suite that is not a real drift. The failure message names the
  empty parse, so the diagnosis is immediate.
- **The pin covers `EntityGraph` only.** `api.ts` hand-mirrors many other
  shapes (`Entity`, `Relation`, `ClientCall`, `Shape`, `Layout3D`, …) and none
  of them is pinned. NOT MEASURED: how far those have drifted. `EntityGraph`
  was the shape the plan scoped.
- **The pin is structural, not semantic.** It compares field *names*. A field
  whose type diverges (e.g. schema `string[]` vs. client `string`) still
  passes. `call<T>()` remains `return body as T` with no runtime validation;
  this file does not change that, it only makes the name-level divergence
  loud.
- **NOT MEASURED**: whether the three `PSQ_NO_CORPUS=1`-skipped files are the
  same three as before this change. Only the aggregate skip count (58, the
  required figure) was checked, and the new file contains no corpus-gated
  tests, so it cannot have contributed to that count.
- **NOT MEASURED**: `pnpm build` / `pnpm build:web` behaviour — deliberately
  never run, per the hard prohibition. The typecheck gate (`tsc --noEmit`
  across four projects) passed, so the new file compiles, but no bundle was
  produced or verified.
