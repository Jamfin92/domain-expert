# Complexity facts → locational questions — ROADMAP

Adds per-function complexity to extraction and turns it into questions that
teach **where** complexity lives, for React and .NET.

Not yet planned in detail — this is the phase split and the decisions that must
hold across all of it. Each phase gets its own plan before it is built.

---

## Why, in the terms that set the design

psq stays a **quiz tool**. The point of knowing your own codebase is not to
recite it. It is to:

- brainstorm improvements from a real map rather than a vibe,
- practise the concepts (complexity, coupling, drift, layering) on your own
  code, so the vocabulary is loaded when you need it,
- and **direct the agent instead of letting it search.** "Refactor the two
  hottest handlers in `Endpoints/`" costs a fraction of "find and reduce
  complexity in this repo", and the difference is context spent per prompt.

Reducing complexity is the *side-effect*. The deliverable is knowing where to
look. That is a positive loop in both directions — the developer gets a map, and
(once M7's export lands) the agent gets the same facts as JSON.

**Three consequences that constrain every design choice below:**

1. **Questions are locational and comparative, never numeric.** "Which of these
   four has the highest complexity?" builds the map. "What is the complexity of
   `X`?" is memorisable trivia and teaches nothing transferable. The number
   belongs in the rationale, never in the answer.
2. **`Question.subjects` is the product, not a footnote.** Subjects are the
   handles the developer pastes into the next prompt. They must be precise
   enough to name a target — a `DefKey`, not a vague label.
3. **Comparative questions soften the McCabe-variant problem, but do not remove
   it.** Two close methods can still reorder between a variant that counts
   `&&`/`||` and one that does not. The ground-truth test must therefore assert
   **both values and ordering**, and a definition must still be chosen and
   written down.

---

## What exists today (measured 2026-09-02, HEAD `1bb9a8a` + branch `m5b-component-attribution`)

**The two stacks are at completely different depths, and that sets the phase order.**

| | React / TypeScript | .NET / C# |
|---|---|---|
| Parser | Real `ts.Program` + `TypeChecker`, `strictNullChecks` forced | Hand-written lexer, `csharp/lex.ts`, no statement grammar |
| Walks function bodies | **Yes** — `node/refs.ts:360`, `node/clients.ts:172` already recurse every node | **No** — `MethodDecl.body: Token[]` (`csharp/structure.ts:33-36`) is retained per method and read by nothing |
| Control flow | not recorded, but reachable | **explicitly discarded** — `csharp/fluent.ts:76` rejects `if/for/foreach/while/return/var/switch/using/try` |
| Routes / endpoints | yes | **hardcoded empty** — `dotnet.ts:613-615`; no controller or minimal-API reading exists |
| Any numeric metric | none | none |

**No metric machinery of any kind exists.** Searched the whole repo for
`cyclomatic|complexity|metric|loc|nesting|fan-?in|fan-?out|coupling|cohesion|maintainab`
— every real hit is prose about the *attribution BFS*, not a code metric.

**No convention/lint engine exists, and the word "convention" in this repo means
something else.** `FactSource = "convention"` means *the framework implied it*
(EF's default delete behaviour). There is no rule engine and no lint config;
`CLAUDE.md` states the only gate is `pnpm typecheck`.

**M6's "STE checks" does not help here.** It is one README line with no design
doc, no stub and no schema field — and it is about validating *agent-written
question prose*, not code conventions. Do not count it toward this work.

---

## The blocker that precedes everything

`packages/extract/src/detect.ts:17-22` returns `"efcore"` if a single `.cs` or
`.csproj` file exists anywhere, before looking at the TS side. **A React + .NET
repo therefore routes entirely to the EF reader and the React pipeline never
runs** — zero components, zero client calls.

This is not an oversight. The docblock states it as a decision:

> A .NET project wins when one is present, because a full-stack repo with a C#
> API and a TS client is a .NET repo for M4's purposes — its client belongs to
> M5.

**That premise expired when M5 landed.** It is a decision to reverse, with its
docblock rewritten to say what is now true — not a bug to patch quietly.

**Nothing tests the case.** `test/fixtures/mini-fullstack` is two *TypeScript*
files (`client.ts`, `server.ts`) — a Node fullstack fixture. No fixture in the
repo holds C# and React together.

**The fixture already exists outside the repo.** `~/Developer/northwind-fullstack`
is 10 C# files and 44 TS/TSX files, Phase B complete and accepted 2026-09-01 at
`55b5437` on `b2-northwind-client`. Vendoring it is already the plan
(`northwind-testbed/progress-b2b-3.md`), and Phase C's stated purpose includes
this exact fix.

---

## Decisions that must hold across all phases

**D1 — Complexity is a def-keyed fact, parallel to `Component`.**
The graph is entity-centric; complexity is per-function. `Component` is already
`{key, name, file, line}` keyed by `DefKey` (`<file>#<name>`), and
`ClientCall.components` already holds `DefKey`s. A new
`FunctionFact { key, name, file, line, complexity, … }` array on `EntityGraph`
follows the established identity rather than inventing a second one.

**D2 — The authority on what complexity means is an external tool, not psq.**
This is the house style, not a new idea. `CLAUDE.md` rule 2a: the authority on a
schema is SQLite, because psq runs the DDL rather than parsing it; entity counts
are validated against an EF migration snapshot psq never writes. Complexity gets
the same treatment:

- **C#** — Roslyn (`Microsoft.CodeAnalysis.Metrics`). `dotnet` 10.0.400 is
  installed, so this oracle is available locally.
- **TypeScript** — ESLint core's `complexity` rule is the candidate. **Read its
  exact counting rules before committing to it** (whether `&&`/`||` count,
  whether each `case` counts). Check whether oxlint has an equivalent; do not
  assume it does.

This means **introducing a linter as a test-only dev dependency** in a repo whose
README says "There is no linter." That is a deliberate exception and must be
argued in the phase plan: it is an oracle, not a gate. It never runs in the
product path.

**D3 — Pick one McCabe variant, write it in the schema comment, and match the
oracle.** Otherwise the ground-truth test fails for reasons that have nothing to
do with psq being right or wrong.

**D4 — Over-counting is a guessed fact, and rule 3 forbids it.**
For C#, token-level counting of `?` **will** over-count: `int?`, `string?`,
`?.`, `??` and `??=` share that token with the ternary. A metric that silently
reports 9 where the truth is 5 would be the first fact in psq that is
confidently wrong rather than honestly absent. Either disambiguate structurally
or narrow the definition — and warn where it cannot tell.

**D5 — No new grade mode for the MVP.** `mostConnected`
(`quiz/src/generate/entity-mcq.ts:194-210`) already sets the precedent: a numeric
fact (`degrees()`) picks the subject, the graded answer is a *name* in `choice`
mode, and the count appears only in the rationale. Following it means **zero
changes** to `GradeMode`, `grade.ts` or `selftest`. Asking for an exact number is
what would force a tolerance mode, `grade.ts:126`'s `never` exhaustiveness check,
and a numeric-aware `selftest.mutate`. **Do not take that on for the MVP.**

**D6 — Every psq standing rule still applies.** Facts come from the graph
(rule 2) — a generator may never compute complexity at question time. Warn,
never guess (rule 3). Every question must be failable under `selftest` (rule 5).
Seeded rng only, sorted output (rule 7). Generators register in `bank.ts` and
nowhere else.

---

## Phases

Each is small enough to plan, build and review in one context window, and each
lands a fact or a question — not scaffolding.

### Phase 1 — C# primary constructors blind the EF reader (REORDERED)

**Measurement on 2026-09-02 reordered this phase.** `detectProvider` is real but
is not the blocker: pointed at `northwind-fullstack/server` directly — bypassing
detection entirely — psq reports `contextName: NorthwindDbContext` with
**0 entities, 0 relations, 18 shapes and 0 warnings.** A C# 12 primary
constructor on the DbContext blinds the reader, silently. Isolated by a
single-variable control on `mini-efcore` (5/4 → 0/0 by changing only the class
declaration).

Every .NET fact — complexity included — would otherwise be built on an empty
entity model, so this comes first. See `plan-phase1.md`.

**Ends with: a modern C# repo yields its entities, and a DbSet-less context
warns instead of returning silence.**

### Phase 1b — Reverse `detectProvider`, and give it a fixture

Make a repo with both stacks extract as both. Add a C#+React fixture (a
`mini-fullstack-csharp`, or the vendored Northwind tag — decide in the plan).

**Not urgent: TypeScript complexity is unblocked today** by pointing `--repo` at
`client/`, which already yields 77 components, 33 shapes and 5 attributed client
calls. Touches `detect.ts`, its docblock, a new fixture, and the tests that pin
provider choice. **Ends with: a React+.NET repo yields both components and
entities in one graph.**

### Phase 2 — TypeScript complexity as a fact

The cheap half, deliberately first: it proves the whole
fact → schema → graph → ground-truth path end to end before paying for the C#
body pass. New `FunctionFact` in `packages/schema`, a counting walk in
`packages/extract/src/node/`, a producer call in `extractNode`, and the oracle
test from D2.

**Ends with: `psq graph` reports per-function complexity for a React repo,
validated against a tool psq did not write.**

### Phase 3 — Locational complexity questions

The `mostConnected` idiom applied to `FunctionFact`. Comparative prompts only,
subjects as `DefKey`s (D1, and the "subjects are the handles" point above).
Registered in `bank.ts`. Must pass `selftest` both ways.

**Ends with: a quiz that teaches where the complexity is.**

### Phase 4 — C# complexity

The expensive half. A new pass over `MethodDecl.body`'s retained token span,
with D4's disambiguation problem solved or explicitly bounded by warnings, plus
the Roslyn oracle.

**Ends with: the same fact and the same questions for .NET.**

### Later, not MVP — graph-shaped conventions

**Do not build a per-file rule engine. That is a linter, and linters already
exist and are already deterministic.** psq's differentiator is the conventions a
per-file tool structurally cannot see, and it already ships one: **drift**
(shape↔table, with the "names reduce to the same concept AND fields
substantially overlap" evidence rule) is exactly a deterministic convention
check, as is the inferred-FK reasoning and its refusals.

That class extends to: a component fetching directly instead of through a
service (M5b's attribution already computes the input), route→table reachability
(M5b's remaining half), layering violations, and orphan entities
(`packages/graph` already exposes `orphans`).

---

## Open questions for the Phase 1 plan

1. **Vendor Northwind now, or add a small `mini-fullstack-csharp`?** Vendoring
   is already planned and gives a realistic target, but it couples Phase 1 to
   the tagging decision that is still open in
   `northwind-testbed/progress-b2b-3.md`. A hermetic mini fixture is faster and
   keeps Phase 1 self-contained. **Probably both, eventually — decide which
   gates Phase 1.**
2. **What does a merged full-stack graph look like?** One `EntityGraph` with
   both providers' facts, or two graphs the CLI composes? `EntityGraph.provider`
   is currently a single value, which suggests this needs a real answer, not a
   cast.
3. **Does complexity attach to components as well as functions?** A React
   component *is* a function, so `FunctionFact` may cover it — but the quiz
   probably wants "which component is most complex", which needs the component
   relationship, not just the def.
4. **Does the corpus ground truth need a new expectation group?**
   `test/fixtures.ts` has `node`/`dotnet`/`structure`/`fluent`; complexity would
   likely be a fifth, and `test/corpus.local.json` is gitignored so the values
   live outside the repo.
