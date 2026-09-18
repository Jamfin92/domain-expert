# H-e — pre-plan measurement (2026-09-18)

**Status: MEASURED, NOT BUILT. No plan exists yet. No code changed.**

Produced before any H-e plan was written, in a scratch clone, against repoA,
repoB and the hermetic `mini-efcore-refs` fixture. Nothing in the working tree
was touched. **This exists because the premise H-e inherited from H-b2 is
false, and the cost of re-deriving that is a scout pass plus five scratch
measurements.**

Corpus repos are referred to by the config's neutral keys. No repo name, path,
or source line appears here — this repo is PUBLIC.

## The headline: the inherited premise is REFUTED

H-b2's record deferred D-Hb-10 to H-e on the reasoning that H-e "narrows
call-vs-mention, so shipping the fix there means the noise never lands" — the
noise being 4 false-positive refs where an ASP.NET controller helper reads the
inherited `ControllerBase.User` (a `ClaimsPrincipal`) whose name collides with
an Identity-derived `User` entity.

**It does not work.** `User.FindFirstValue(...)` is a member *invocation* — the
most call-shaped construct in the sample. Measured across three readings:

| reading of "call-shaped" | repoA | repoB | fixture | A+B |
|---|---|---|---|---|
| R1: the entity token is invoked — `next == "("` | 0 | 0 | 0 | **0** |
| R2: it heads a member invocation — `next == "."` ∧ ident ∧ `"("` | 79 | 36 | 1 | **115** |
| R3: R1 ∨ R2 | 79 | 36 | 1 | **115** |

- **R1 is inert** — entity class names are never invoked as functions, so the
  literal reading selects nothing and can decide nothing.
- Under **R2/R3 all 14 known false positives are INSIDE the call-shaped set**
  (measured containment: `RECV ∧ ¬CALL2 = 0` in all three inputs). Keeping only
  call-shaped refs retains every false positive and discards 188 of 303 genuine
  mentions. Dropping call-shaped refs removes the 14 but also **101
  `via: dbSetName` query refs** — the walker's strongest signal.

**A call-vs-mention axis does not cut where the false positives are.**

## What does work: the receiver-position rule

`prev != "." ∧ next == "."` — a bare identifier used as a receiver.

| | repoA | repoB | fixture | A+B |
|---|---|---|---|---|
| matches, baseline | 3 | 7 | 0 | 10 |
| matches, after D-Hb-10 | **7** | **7** | **0** | **14** |
| of which are the framework-property collision | 7 (100%) | 7 (100%) | — | **14 (100%)** |
| of which are clearly genuine | **0** | **0** | — | **0** |

Grouped by (entity, member read) the post-fix match set is exactly two rows.
Blast radius **4.6%** of A+B, confined entirely to `via: entityName` — it
touches **0 of 101** `dbSetName` refs. Disjoint from the navigation rule by
construction: the genuine navigation reads have `prev == "."` and fall the
other side. Confirmed independently of token shape: the colliding entity
declares 30 members (repoA) / 20 (repoB) and **neither declares the members
being read** — they are framework reads.

## D-Hb-10, re-measured against the shipped walker

| | baseline | after fix | delta |
|---|---|---|---|
| repoA | 241 | **247** | **+6** (4 false, 2 genuine) |
| repoB | 56 | 56 | 0 |
| fixture | 20 | 20 | 0 |

Ref-level diff `+6/−0`, not just totals. Entities, relations, shapes and
warnings are **unmoved**; `warnings` stays `[]`. This reproduces H-b2's
prediction exactly and re-confirms that H-b1's "+2 refs / zero controllers"
figure is refuted.

## The malformed-input trap — CONFIRMED verbatim

On `class C { public int A() => F(1; public int B { get; set; } public void Z() {...} }`:

| variant | methods | properties | warnings |
|---|---|---|---|
| today (shipped) | 2 | 1 | `[]` |
| naive depth-tracked fix, no fallback | **1** | **0** | **`[]`** |
| depth-tracked + terminator-not-found fallback | 2 | 1 | `[]` |

**A property and a method vanish with no warning.** Cause: the depth counter is
wedged by the unbalanced `(`, the scan runs to `to`, and `i = k + 1` lands past
the class body. **Ship the fallback, not the bare depth-tracked scan.**

## Two claims to correct, and two gate gaps to close

1. **"Exactly ONE construct gates the depth tracking" is too narrow.** The real
   class is *any expression-bodied member whose expression holds a statement
   lambda or block literal containing a `;`* — three diverging shapes found.
2. **On real inputs the shipped first-`;` terminator and the depth-tracked scan
   produce IDENTICAL output** (repoA 247, repoB 56, fixture 20). Depth tracking
   is **defensive only**; the fallback is the part that prevents a real failure.
3. **The fixture matches the receiver rule 0 times** — there is no positive
   control for it outside the private corpus. A gate built on it without a new
   hermetic fixture case would pass by finding nothing.
4. **The suite is 460/460 green both with and without D-Hb-10.** Nothing
   anywhere gates it in either direction. A suite that is green both ways is
   not a gate.

## Not measured

Whether repoC/repoD/repoE contain either construct. Any effect on the graph,
quiz or server layers beyond the suite already run.
