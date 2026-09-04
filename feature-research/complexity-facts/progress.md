> **Superseded 2026-09-03. The current phase record is `progress-1b.md`
> (Phase 1b-i) — start there. This file is Phase 1's record, kept intact.**

# Phase 1 — PROGRESS

**Status: ACCEPTED 2026-09-02. Uncommitted — the work sits in the working tree
on branch `m5b-component-attribution`, on top of HEAD `a064d80`. James commits.**

Plan: `plan-phase1.md` (Revision 2). Audit: `audit.md`. Both reviewer rounds
returned **Ship**, no blocking issues, with the reviewer re-deriving every gate
itself rather than reading the audit back.

---

## What shipped

**A base constructor argument list no longer truncates C# type parsing.**
A four-line change at `packages/extract/src/csharp/structure.ts:495-504` skips a
balanced `(...)` after each base type ref, so parsing continues to the `where`
clause and the body instead of falling into the bodyless-declaration branch.

**A type header not terminated by `{` or `;` now warns** (`structure.ts:542-556`).
This is the generalising fix: it catches the whole truncation class — contexts,
entities, DTOs, interfaces — not just DbContexts. Before this, a parse failure on
a non-context type was completely silent, and a type that fell below
`MIN_PROPERTIES = 2` vanished from the graph with nothing said.

**A selected DbContext that contributed no entities warns** (`dotnet.ts:455-456`).
The roadmap's stated end-state for this phase: *a DbSet-less context warns instead
of returning silence.*

### Measured, on `~/Developer/northwind-fullstack/server`

| | before | after |
|---|---|---|
| entities | 0 | **8** |
| relations | 0 | **8** |
| shapes | 18 | **10** |
| warnings | 0 | 0 |

Verified a **move, not a copy**: `entities ∩ shapes` is empty and 8 + 10 = 18.
`csharp/shapes.ts` was never touched — the split comes from the pre-existing
`entityNames.has(decl.name)` skip at `csharp/shapes.ts:37`.

---

## Decisions made this phase

**D-1. The zero-entity warning was kept, narrowed.** Three binding constraints,
all verified in review:

- condition is `entities.length === 0` — **"contributed no entities at all"**, not
  "zero `DbSet<T>` members". An `IdentityDbContext<User, …>` contributes `User`
  with no DbSet, so it has `entities.length === 1` and stays silent.
- skips `abstract`.
- fires for **the single context selected at `dotnet.ts:301`**, not a loop over
  `contexts`.

**D-2. Do not re-pin the corpus repo-D route expectation when it goes stale.**
It was re-verified and updated during this phase (all routes traced to production
source with `file:line`), was green, and went stale again the same day when that
repo took four more commits. Re-pinning is churn. The durable fix is to split the
assertion — see follow-up 1.

**D-3. The new fixture's own numbers are 3 entities / 2 relations**, not the
plan's "5 / 4". Those were `mini-efcore`'s numbers with a primary constructor
temporarily bolted on — which the plan then forbade modifying. A fresh fixture
legitimately has its own model.

---

## What the next phase needs to know

**1. Gate 3 ("full `pnpm test`, 0 failed") is NOT re-verifiable on demand.**
It was genuinely met at time of measurement and is now red again: the corpus
repo-D route list is a full ordered `toEqual` over a live repo that moves under
it. Treat any full-suite number as time-stamped. **`PSQ_NO_CORPUS=1` is the gate
that actually reproduces** — currently **178 passed | 58 skipped (236)**, from a
baseline of 161 | 58.

**2. `>>` in a base list is a live silent-truncation class, and it hits a real
DbContext shape.** The lexer emits `>>` as one token (`lex.ts:51`) and
`matchBracket` never closes, so:

- `IdentityDbContext<User, IdentityRole<Guid>>` **loses every DbSet** while
  `isDbContextBase` still matches on the head — pre-phase, that produced exactly
  the silent zero-entity graph this phase exists to eliminate.
- the 3-arg form `IdentityDbContext<User, IdentityRole<Guid>, Guid>` parses fine;
  the trailing `, Guid` separates the `>`s. Only the adjacent-`>>` form breaks.
- `IRequestHandler<Q, List<Dto>>` (MediatR-style) truncates the same way.

This phase makes it **loud rather than silent** — both new warnings fire together
on that case — but does not fix it.

**3. `findContexts` only matches a class whose OWN bases include
`DbContext`/`IdentityDbContext`** (`dotnet.ts:165-170`). With an abstract base
holding no DbSets and a derived context holding them all, the derived context is
never seen and the abstract base *is* the selected `ctx` — `contextName` comes
back as the base. This is why the `abstract` skip in D-1 is load-bearing rather
than defensive; without it that pattern warns every time.

**4. Six of six rule-2 pin categories now have committed hermetic coverage** —
composite key, `ToTable`, `Cascade`, `Restrict`, `fluent`, and
`ClientSetNull`/`convention`. `ToTable` was the last one that existed only behind
a corpus gate.

**5. Northwind's 8 / 8 / 10 / 0 is still measured by hand.** It is not one of the
six corpus keys, so the headline result of this phase is not defended by any
committed test.

---

## Files touched

1. `packages/extract/src/csharp/structure.ts` — base argument list, header warning
2. `packages/extract/src/dotnet.ts` — narrowed zero-entity warning
3. `test/fixtures/mini-efcore-primary-ctor/**` — new
4. `test/fixtures/mini-efcore-empty-context/**` — new
5. `test/fixtures.ts` — two exported constants + docblocks
6. `packages/extract/test/structure.test.ts` — parser-level regression tests
7. `test/mini-efcore-primary-ctor.test.ts` — new, incl. hermetic `mkdtemp` tests
   for the `abstract` branch
8. `test/corpus.local.json` — repo-D route ground truth (gitignored, not committed)

**Not touched:** `detect.ts`, `csharp/shapes.ts`, `lex.ts`, `mini-efcore` and its
tests, any quiz generator, any app, the schema.

---

## Queued follow-ups, in the order they are worth doing

1. **Split the repo-D route assertion** (`packages/extract/test/node.test.ts:79-80`).
   Keep `warnings.some(/regular expression/)`; replace the full-list `toEqual`
   with a subset or floor check. Removes a permanently-flaky gate. Not in this
   phase's "Files touched", which is why it was not done here.
2. **Split `>>` in the lexer / `matchBracket`.** Highest-value parser fix
   available: removes a live silent-truncation class on a real DbContext base
   form *and* most of the new warning noise.
3. **`record struct` warning text.** `public readonly record struct Id(Guid Value);`
   parses to a bogus type literally named `struct` and warns about a type that
   does not exist — a worse failure mode than noise. Fix the naming, or include
   the source line text so the construct is identifiable.
4. **Pin Northwind's 8 / 8 / 10 / 0** in a committed test.
5. **Investigate the `apps/server/test/api.test.ts:213` flake** (SQL grading).
   Seen once in ~13 runs; provably unrelated to this phase — that test opens
   `MINI_EFCORE`, which has no base argument list and no unterminated header, so
   its parse output is byte-identical before and after. Belongs to whoever owns
   the SQL grader. Rule 7 makes it worth a look.
6. **`README.md:336-337` claims 138 / 193 tests.** Actual is now 178 / 236.

---

## Next phase

**Phase 1b — reverse `detectProvider`, and give it a fixture** (`roadmap.md`).
`detect.ts:17-22` returns `"efcore"` if a single `.cs`/`.csproj` exists anywhere,
so a React + .NET repo routes entirely to the EF reader and the React pipeline
never runs. The docblock states it as a decision, not an oversight — the premise
expired when M5 landed, so the docblock gets rewritten, not patched quietly.

Note it is **not urgent**: TypeScript complexity (roadmap Phase 2) is unblocked
today by pointing `--repo` at `client/`, which already yields 77 components,
33 shapes and 5 attributed client calls. If the goal is to reach a complexity
fact soonest, Phase 2 can go first.

Roadmap open question 2 — *what does a merged full-stack graph look like?* —
must be answered in the Phase 1b plan, not cast away. `EntityGraph.provider` is
currently a single value.
