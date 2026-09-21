# H-e — phase record

**ACCEPTED 2026-09-21. UNCOMMITTED and UNPUSHED.** Ten tracked files modified;
`master` is still 4 ahead of `origin/master` from the earlier demo-harden phase.

**This file and `audit.md`/`plan.md` are UNTRACKED.** A `git clean` deletes the
phase record. Commit them with the work or copy them out first.

Corpus repos are named by the config's neutral keys only. **This repo is PUBLIC** —
never commit corpus source, corpus file paths, or absolute home paths.

---

## The name is a misnomer — read this before anything else

The directory says `call-vs-mention`. **Nothing in this phase narrows
call-vs-mention, because that axis does not cut where the false positives are.**
`measurement.md` refuted the premise H-e inherited from H-b2 before any plan was
written: `User.FindFirstValue(...)` is the most call-shaped construct in the
sample, so keeping only call-shaped refs *retains* all 14 false positives and
discards 188 of 303 genuine mentions. The literal reading (`next == "("`) selects
0 refs in all three inputs — entity class names are never invoked as functions.

The name is kept only so H-b2's pointers still resolve. **Do not revive the
call-vs-mention idea from the directory name.**

## What shipped

**A — expression-bodied method bodies are captured** (`packages/extract/src/csharp/structure.ts`).
The method `=>` branch previously pushed `body: []`, so refs inside an expression
body were invisible. It now runs a depth-tracked scan mirroring the
expression-bodied *property* branch, and captures the tokens. Three required
parts, all present: warn in the existing `${file}:${line}:` form, fall back to
`body: []`, and resume from the first `;` ignoring depth when the scan reaches
`to` without a balanced terminator.

**B — the receiver-position rule** (`packages/extract/src/csharp/entity-refs.ts`).
Drops a candidate ref whose entity token has `prev != "." && next == "."` — a bare
identifier used as a receiver. The `continue` is placed **before** `seen.add(key)`;
below it, a discarded ref would claim the dedupe key and suppress a legitimate
later mention on the same line.

**`EXTRACTOR_VERSION` 2 → 3** (`packages/extract/src/detect.ts`). Both changes alter
extraction output and stored envelopes re-extract only on a version difference.

## Measured, not predicted

| | baseline | after A | after A+B |
|---|---|---|---|
| repoA | 241 | 247 | **240** |
| repoB | 56 | 56 | **49** |
| fixture | 20 | — | **22** |

Ref-level multiset diffs, not totals: repoA baseline→A is **+6/−0**, A→A+B is
**+0/−7**, net **+2/−3**. All 14 removals across A+B are `via: entityName` on the
one colliding entity; **0 `dbSetName` rows removed**. Entities, relations, shapes
and warnings unmoved at all three points in both repos.

Suite **464 → 479**. `PSQ_NO_CORPUS=1` **406/58 → 421 passed / 58 skipped**.
Typecheck clean. `test:e2e` never run (it empties the served `apps/web/dist`).

**A skipped count below 58 means the private corpus config vanished — stop, do not
"fix" it.**

## Decisions taken

1. **B lives at extraction time, not in `refsFor`.** `EntityGraph` carries no
   tokens, so a receiver-position test is impossible downstream. Rejected:
   adding an `EntityRef` field for query-time filtering — it needs a
   `packages/schema` change and buys reversibility for refs that are noise by
   measurement. **Consequence, accepted knowingly: dropped refs leave no trace.**
2. **Ship the full change A** — depth tracking *and* the fallback — rather than the
   minimal "capture tokens with the existing first-`;` scan".
3. **§6 takes the hermetic gate** (option a): an inline expression-bodied
   `OnModelCreating` case in `fluent.test.ts` that runs under `PSQ_NO_CORPUS=1`,
   rather than recording the capability as ungated.

## Three facts about the design that must not be re-derived

1. **B cannot touch `dbSetName` refs, by construction.** That `via` is assigned at
   exactly one site, inside a guard requiring `prev.text === "."`. B requires
   `prev != "."`. Disjoint by code, not by corpus coincidence.
2. **Depth tracking is defensive on real inputs and corrective on one shape.**
   Measured: the shipped first-`;` terminator and the depth-tracked scan produce
   identical output on repoA/repoB/fixture. But on a **local function inside a
   statement lambda**, the pre-H-e reader emitted the local function as a class
   method *with a body*, attributing refs to a member the type does not have. On
   that shape A is a correctness fix, not a hardening. No corpus repo has it.
3. **The rule is syntactic and has stated limits**, recorded in `entity-refs.ts`:
   a genuine static-member access on an entity type (`Student.Create(...)`) would
   be dropped (measured occurrences: 0), and `?.` / `!.` receivers escape it
   entirely — `User?.FindFirstValue(...)`, the exact corpus phenomenon, would
   survive. Harmless today; both are documented, neither is fixed.

## Gates — eleven mutants, all verified to redden

M1 blank captured body · M2 delete fallback · M3 delete fallback warning ·
M4 delete rule B · M5 drop `prev != "."` · M6 drop `depth <= 0` ·
M7 drop `next == "."` · M8 revert `EXTRACTOR_VERSION` · M9 revert A against the
`fluent.test.ts` hermetic case · M10 move `continue` below `seen.add` ·
M11 break the success-path resume (`i = scan + 1` → `i = to`).

Two worth knowing:
- **M8 reddened nothing before this phase.** `rehydrate.test.ts` read the constant
  symbolically (`toBe(EXTRACTOR_VERSION)`), so G23 was green at any value. Two
  literals now gate the value behaviourally. A declaration cannot be gated by a
  test that merely reads it.
- **M11 reddens exactly one test in the whole suite** — the restored member-list
  gate. Before round 3 it reddened nothing, which is the measurement proving the
  success-path resume had no hermetic coverage.

**M1 is not equivalent to pre-H-e code.** It blanks the captured body but leaves
the scan and resume point intact, so the member list is unchanged. Reverting the
whole branch to HEAD reddens strictly more. Do not treat them as the same mutant.

## Fixture anchors — what must not move

`test/fixtures/mini-efcore-refs/Services/EnrollmentService.cs` and
`Controllers/CoursesController.cs` both carry the `Dup.Sync` anchor at **line 55**;
a cross-file gate reads `lines[54]` in both. All H-e cases were appended at 56+.
The 29-line comment block at lines 26-54 is **structural padding, not prose**.

Four named constants in `entity-refs.test.ts` point at fixture lines. **Their values
are deliberately not restated here** — that is what went stale in round 1 of the
audit. Read them from the file.

## Open items this phase did not close

- **An unexplained 401** at `apps/server/test/api.test.ts:74`. That response
  requires the bearer gate, which `createApp` mounts only when a token is
  configured, and the test passes none. Pre-existing, untouched by H-e, genuinely
  unexplained. First place to look: `auth.test.ts` builds token-configured apps in
  the same worker — connection or port reuse.
- **The `apps/server` flake is pre-existing.** Measured by swapping the ten files
  for their `HEAD` contents and running the hermetic suite 106 times per tree:
  clean **2/106**, with H-e **4/106**. That supports **"no detectable increase"** and
  nothing stronger — at n=106 an added ~2% flake is invisible, the arms ran
  different test populations (406 vs 421), and **no individual failing test
  reproduced across arms**. Keep it filed separately from the H-b2 assertion flake
  and the `entity search` timeout.
- **`apps/server/package.json` still does not declare `zod`.** Eighth phase running.

## What the next phase inherits

Ladder: **H-c** (TS side, capped by the ~4% `mirrors` bridge), **H-a2** (CLI + web —
`apps/web/src/lib/api.ts`'s hand-written `EntityGraph` subset, now drift-pinned),
**H-d** (.NET route blind spot).

**Decide before starting: commit and push, or keep holding.** `master` is 4 ahead
from demo-harden plus this phase uncommitted. The repo is public and every commit
must be swept for corpus names and paths first.

## Rules earned

**(14) A gate that passes by finding nothing includes a gate whose *premise* is
ungated.** The receiver control was right only because a colliding member is
declared; deleting that declaration reverted the case to asserting the wrong
answer while the gate stayed green. Structural protections were added for the
line's content, its aloneness, and finally the collision itself.

**(15) Rule 10 applies to review corrections, three rounds running.** Round 1's fix
introduced a false "Measured:" comment on a vacuous test. Round 2's correction of
that replaced it with a false universal ("no input can do better") that a
twenty-line probe refutes — and which was load-bearing for deleting a test that
turned out to be the only hermetic cover for the success-path resume. **A
universal claim read off the code is not measured, however carefully reasoned.**
Round 3 fixed it by measurement and struck the false passages in place rather than
rewriting them clean — which is the practice to keep.

**(16) Restating a value is how records go stale.** The audit's per-file section
carried constant values that four rounds of fixes silently invalidated. The fix
was to **delete the second copy and point at the file**, not to update it.

**(17) An uncaptured red proves nothing about which flake it was** — including when
it is consistent with one you have already measured.
