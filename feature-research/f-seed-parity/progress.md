# Phase F — seed parity, and a choice selectable by its own text — PROGRESS

**Status: SHIPPED at `f0bceaa` (2026-09-09); reviewer "Ship" with zero blocking
findings on the first pass; James accepted.** Feature commit on `f-seed-parity`,
branched from `master` at `9770685`. This record and the approved plan are
committed on top and `master` fast-forwarded to it — the D1/D2/D-A-3 shape.
**Not pushed** (James's call, as in Phase E).

Plan: `plan.md` — approved as rev 2, after a plan review raised four blocking
items. Rev 1's *design* survived intact; its **gates** did not, and two of its
three controls were vacuous. Audit: `audit.md`. Previous record:
`../m5c-ii/progress.md`.

---

## What shipped

Two defects Phase E measured and deliberately left. They shipped together because
they compose: seed parity is what makes `psq selftest` a gate for the served bank,
and the grading bug is what that gate had been failing to catch at one seed and
catching at another.

| Part | Where | What |
|---|---|---|
| The grading fix | `packages/quiz/src/grade.ts:48-58` | choice text is matched **first**; the letter/number shortcut applies only to input matching no choice |
| The one default | `packages/quiz/src/rng.ts` | **new** `DEFAULT_SEED = 1337`, re-exported from `index.ts` |
| Choke point | `packages/quiz/src/bank.ts` | resolves `seed ?? DEFAULT_SEED` **once**, passes a resolved number to all six generators |
| Second line | the six `generate/*.ts` | each defaults to `DEFAULT_SEED` instead of `hashSeed(g.repo)` |
| Literals | `sql/seed.ts:232`, `apps/server/src/workspace.ts:137`, `apps/cli/src/index.ts:95` | the three hardcoded `1337`s |
| Selection | `apps/cli/src/index.ts:193` | `hashSeed(g.repo)` → `DEFAULT_SEED`; dead `hashSeed` import at `:12` deleted |
| Four stale reasons | `client-mcq.ts:61-67`, `test/client-mcq.test.ts:154-157` (comment **and** title), `component-label.ts:14`, `apps/cli/src/index.ts:210-214` | every site that documented the old behaviour |
| Grading tests | `test/grade-choice.test.ts` | **new**, 8 cases, hermetic |
| Parity tests | `test/seed-parity.test.ts` | **new**, 4 cases, hermetic |

`psq quiz` **changes behaviour by design**: question order was seeded from the
repo path, now from `DEFAULT_SEED`, matching the server. It is the one
user-visible change in the phase.

## The finding this phase turns on

**Selftest was blind to five of the six casualties, and the sixth is the only
reason anyone looked.**

`grade.ts:52` tested the *shape of the input* and never the choices, so any
one-letter input was read as an option letter before the text branch could run.
That is worse than bad luck with indices: a one-character choice past `d` maps to
an index **out of range for a four-choice MCQ** (`x` → 23, `y` → 24), so it was
unreachable **structurally**, at every seed.

Census over six corpus roots, 379 choice-mode questions, at the CLI's old default
seed: **6 one-character choices, 0 numeric, 0 normalizing to a bare `a`–`d`.**
Of the six, **one was the answer** — the single visible selftest finding — and
**five were distractors**, four of them across three questions in **repoD, a root
selftest reports `ok`**. A learner could never select any of the five. They passed
because a mutation to them graded "wrong" **for the wrong reason**: the input was
unparseable, not badly chosen.

So the gate was green on five silently unanswerable options. This is the
repo's recurring shape — a check that passes by finding nothing, passing because
it broke — and it is why the phase censused `normalize(choice)` rather than
trusting the one red finding to bound the damage.

**Correcting Phase E's record:** it attributed the casualty to `client.busiest`.
Measured, it is `not-a-member`, a **ds-mcq** question. The generator that *has* a
guard (`client-mcq.ts`'s `unselectable()`) is not the one that was hurt —
`entity-mcq.ts:26-53` and `ds-mcq.ts:33-60` each carry their own unguarded `mcq()`
helper, and `ds-mcq.ts:188` passes `distractors: shape.members` unfiltered.

## The correction most worth remembering

**A hardening suggestion silently destroyed the phase's control sensitivity, and
the plan review that produced it did not notice.**

The review's non-blocking item — "D-F-3 leaves two different defaults alive; change
all six generators too, it is a six-token diff at zero behavioural risk" — was
correct on its own terms and was adopted. Its unstated cost: `bank.ts` and the six
generators each became a *sufficient* defence, so **each masks the other's
control**. Measured by the reviewer, re-running the whole matrix:

```
revert bank.ts alone      -> 4 passed (4)     no gate moves
revert the generators alone -> 4 passed (4)   no gate moves
revert both               -> 2 failed | 2 passed   cases 1 and 3 fail
```

Neither test is vacuous — both move for the combined revert — but the plan's
per-file attribution in gate 10 **cannot be reproduced**, and a future refactor
that removes `bank.ts`'s resolution alone will stay green.

Two more of the plan's own gates were wrong, both caught by the implementer with
measurements rather than argument:

- **`apps/cli:95` can never gate parity.** The literal it replaced was `1337` and
  `DEFAULT_SEED === 1337`, so the revert is numerically a no-op. The CLI's real
  divergence was `:96` forwarding a bare `undefined` — **a line the plan never
  listed**, unchanged by this phase, now resolved by `bank.ts`.
- **Gate 11 as sketched was vacuous.** At the fixture with `n=3`, reverting `:193`
  produced identical output. It only moves on a corpus root at `n=12`. It was run
  as an ad-hoc measurement and **deliberately not committed** — a gate needing the
  private corpus goes silently dead on a machine without it.

The generalisable lesson, and it is not the obvious one: *defence in depth and
gate sensitivity trade against each other.* Adding a second correct guard makes
the system harder to break and the breakage harder to detect. When you accept a
"free, zero-risk" redundancy, re-derive the controls that were supposed to prove
the first guard works — the review that suggests the redundancy is exactly the
review that will not think to.

And one that repeats from Phase E: **a control run at the wrong seed reports `ok`
and reads as "the fix did nothing."** Gate 9 had to run at `hashSeed` of the repo
path (`916108129`, verified by three independent computations), because at the new
default seed the defect does not exist. The reviewer reproduced both halves: the
*same reverted* binary is red at `916108129` and green at `1337`.

## Gates

| Gate | Baseline (`9770685`) | Result |
|---|---|---|
| `pnpm typecheck` | clean | clean, all four projects |
| `PSQ_NO_CORPUS=1 pnpm test` | 272 \| 58 (330) | **284 \| 58 (342)**, 0 failed |
| `pnpm test` | 330 | **342**, 0 failed |
| census, before editing `grade.ts` | — | 6/0/0/0 at the old seed, 3/0/0/0 at 1337 |
| `grade-choice.test.ts` at baseline | — | **3 failed \| 5 passed**; cases 1, 7, 8 |
| selftest, 6 roots, default seed | repoAClient 1 finding | **all six `ok`**, 213/107/2/136/56/89 |
| selftest, 6 roots, `--seed 1337` | — | byte-identical to the default-seed run |
| control (a), `grade.ts` reverted, seed 916108129 | — | the finding verbatim; `ok` when restored |
| control (b), parity | — | **only the combined revert moves it** (see above) |
| control (c), selection `:193` | — | moves on repoAClient at n=12; ad-hoc, not committed |
| determinism | — | selftest ×2 and piped quiz ×2 byte-identical |
| `git show --stat` | — | exactly the 18 paths |

The **skipped count held at 58** at every step. A drop there means the private
corpus config vanished, not that something improved.

## What the next phase needs to know

- **FIRST ITEM, carried by James's decision: make the CLI resolve its seed once.**
  `apps/cli/src/index.ts:95-96` still reads as if the two seeds could differ —
  `:95` resolves `seed ?? DEFAULT_SEED` for `materialize`, `:96` forwards bare
  `seed` to `composeBank`. It is correct today only because `bank.ts` resolves it,
  and it *is* gated (parity case 3 fails under the combined revert). The server
  (`workspace.ts:137-139`) resolves once and hands the same number to both calls.
  Two tokens — `const s = seed ?? DEFAULT_SEED;`, passed twice — stop the two
  shells being structurally different at the one place this phase existed to make
  them identical.
- **No single-file revert of the seed path is detectable any more.** See the
  correction above. If you refactor `bank.ts`'s resolution out, no test will tell
  you.
- **`normalize()` makes the shadowing hazard far more reachable than "6
  one-character choices" suggests.** It slices the head at its **last `.`**, so an
  ordinary label like `Foo.B` normalizes to `"b"` and would shadow option letter
  `b`; `Foo.1` normalizes to `"1"`. Measured 0 today across 445 choice-mode
  questions at both seeds — but **no committed test re-runs that census**, and
  nothing fails if a future generator emits one. The reviewer would raise the
  priority of a selftest rule for this above the footnote the plan gave it.
- **`selftest.ts:47`'s new coupling is fail-LOUD, and that is the whole reason it
  needs no guard.** It mutates by `String(other + 1)`, which under text-first now
  hits choice text before the index shortcut. If that ever resolves to the answer
  index, selftest raises "cannot be got wrong"; if it resolves anywhere else the
  mutation still grades wrong, which is all the failability check needs. **There
  is no configuration in which the new precedence lets an unfailable question pass
  silently.** Record the direction so the next reader does not over-weight it.
  Mutating by `choices[other]` text would remove the coupling and exercise the
  path a human actually uses — still the recorded follow-up, still not urgent.
- **`hashSeed` is now dead production surface, kept alive by one test.** It
  survives only at `rng.ts:56`, the re-export at `index.ts:14`, and
  `test/seed-parity.test.ts:8,63`. No production caller remains. **Deleting it
  would silently remove parity case 2 — the only thing keeping case 1 honest.**
- **Gate 13's wording made scope-detection dictate document retention.** "Exactly
  18 paths" is why `plan.md` was left untracked for a shipped commit, one `git
  clean` from gone. Word it "18 code/test paths plus phase records" next time.
  (Fixed here: the plan is committed with this record.)
- **`--section` help and its own error message disagree.** `apps/cli/src/index.ts:213-214`
  now correctly lists `(entity, client, ds)`, but `sectionArg()` at `:73` still
  prints `Known: ${Section.options.join(", ")}` — all six, including
  `agent-entities` / `agent-client` / `agent-ds`, which **no generator emits**
  (`packages/schema/src/index.ts:324-331`). Pre-existing, surfaced by this edit.
- **`questions/entity.json` holds the ENTIRE bank, not the entity section** —
  `apps/cli` writes `qs` there unconditionally. Parity case 3's byte comparison
  therefore covers `entity`/`ds`/`client` seeds despite the filename. **Do not
  "improve" it by splitting the comparison per section**; the filename is the
  wart, not the test.
- **The live service still serves none of this.** `com.psq.server`, pid 16538,
  `tsx`-loaded `packages/quiz` source on `Fri Sep 4 15:05:56`. This phase changes
  that source. Deploy remains James's call; nothing was restarted.
- **`pnpm test:e2e` was not run, by instruction.** It runs `pnpm build:web`, which
  empties the served `apps/web/dist` mid-build, and this checkout is the live
  personal deploy. No e2e coverage was added or exercised; e2e stays at 23.
- **`--seed abc` is silently seed 0** in both shells: `Number("abc")` is `NaN`,
  not `undefined`, so `??` never fires and `rng(NaN)` seeds `0`
  (`rng.ts:23`, `NaN >>> 0 === 0`). Pre-existing, unfixed, now the only
  seed-resolution wart left.
- Carried forward unchanged: unifying the three duplicated `mcq()` helpers behind
  one guarded builder; `README.md:25-38` still has no M5c row (offered twice, not
  taken); drift-site id collisions; no Dockerfile, no CI; the corpus config is the
  only copy of the ground truth.
- **Deferred milestones remaining**: quiz history / weak-area persistence keyed by
  repo id, and the .NET route reader — M5b's remaining half, without which "which
  endpoint touches which table" has no .NET side.
