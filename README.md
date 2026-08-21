# psq — Ps and Qs

Read a codebase. Then prove you know it.

psq extracts the structure of a project, generates questions whose answers it
already holds, and grades your answers. It works on .NET / EF Core today.
Node backends and React clients come next.

## Why this exists

You cannot hold a large codebase in your head by reading it. You find out what
you actually know when something asks you and checks the answer.

psq does two jobs from one extraction:

- **You** get an entity graph, a diagram, and a graded quiz.
- **An agent** gets the same graph as JSON it can index, plus a domain brief.

One design rule shapes everything here:

> Every question ships with a grader that needs no model.

An agent may write the prose of a question. It may never decide whether an
answer is right. A model that both writes and grades measures nothing.

## Status

| Milestone | State |
|---|---|
| M1 — entity graphs, multiple choice | done |
| M2 — short answer, cloze, SQL over a seeded database | next |
| M3 — web app: bento dashboard, interactive graph | planned |
| M4 — Node backends, data structures | planned |
| M5 — React clients, cross-layer links | planned |
| M6 — agent-authored questions, STE checks | planned |
| M7 — working memory export | planned |

## Install

```bash
pnpm install
```

Node 24 or later. No native build step.

## Use

```bash
# extract the entity graph
pnpm psq graph --repo ../corpus-repo-a/server/src/corpus-repo-a.Api

# write the graph and a mermaid diagram to disk
pnpm psq graph --repo <path> --out .psq

# build the question bank
pnpm psq questions --repo <path>

# prove every question can pass AND fail
pnpm psq selftest --repo <path>

# take a quiz
pnpm psq quiz --repo <path> --n 10
```

Add `--seed <n>` to fix the generator seed. The same repo and seed always give
the same questions in the same order.

## What it reads

psq parses C# directly. It does not build the target project, so it works on a
repo that does not compile on this machine.

An entity is a class you can reach from a `DbSet<T>` or from an Identity base
type argument. Every other class is ignored. That rule is what keeps DTOs,
services, and stale duplicates out of the graph.

Measured against `corpus-repo-a`:

| Fact | Value |
|---|---|
| Entities | 17 |
| Relations | 20 |
| Warnings | 0 |
| Questions generated | 102 across 10 generators |

Both numbers match `Migrations/AppDbContextModelSnapshot.cs`, which EF
generates and psq never writes. The snapshot declares 17 domain entities and
26 `HasForeignKey` calls; 6 of those belong to the Identity join tables.

### Constructs it handles

- `IdentityDbContext<TUser, TRole, TKey>`, not only `: DbContext`
- Both `DbSet<T> X { get; set; }` and `DbSet<T> X => Set<T>()`
- Both fluent styles: `builder.Entity<T>().HasOne(...)` and
  `builder.Entity<T>(e => { e.HasOne(...); })`
- Members inherited from a base class, including `IdentityUser<TKey>`
- Composite keys, unique indexes, precision, max length
- `IsRequired(false)`, which makes a relationship optional
- Modern C#: `required` members, file-scoped namespaces, collection
  expressions, and interpolated raw strings

### Why the parser is hand-written

The prebuilt tree-sitter C# grammars on npm are built against tree-sitter 0.20.
That grammar fails on `corpus-repo-a/.../LicenseApplication.cs`, which uses
`required` members and `= []`. The current grammar has no compatible prebuilt
wasm, and the native binding needs node-gyp.

psq needs a narrow, regular subset of C#. Getting the *literals* right is what
matters, because a `;` or `{` inside a string must never look like structure.
The lexer guarantees that. Anything it does not recognize becomes a warning,
never a guess.

## Delete behavior: written or derived

EF applies a default when a repo does not declare `OnDelete`. psq records which
one you are looking at:

- `fluent` — the repo wrote `OnDelete(DeleteBehavior.X)`
- `convention` — EF's default: `Cascade` for a required foreign key,
  `ClientSetNull` for an optional one

`corpus-repo-a` declares no `OnDelete` at all, so psq marks all 20 of its
relations `convention` and **asks no delete-behavior questions about it**.
A question must test the codebase, not an EF default.
`corpus-repo-b` declares seven, so those become questions.

## `psq selftest`

Run this before you trust a question bank.

A question that always passes cannot be told apart from a question whose
grader is broken. So psq proves every question twice: once with its reference
answer, which must pass, and once with a mutation, which must fail.

It also checks the set as a whole. Two questions with the same prompt and
different answers mean one of them is wrong, and the reader cannot tell which.
That fault is invisible in any single question.

The command exits non-zero on any finding.

## Development

```bash
pnpm typecheck   # tsc --noEmit, strict + noUncheckedIndexedAccess
pnpm test        # vitest, hermetic
```

There is no linter. `tsc` under `strict` is the gate.

The suite has two layers. Hermetic tests run against
`test/fixtures/mini-efcore`, which lives in this repo. Corpus tests run against
real projects on this machine and validate extraction against ground truth psq
did not produce. Corpus tests skip when those projects are absent:

```bash
PSQ_NO_CORPUS=1 pnpm test   # 15 tests, no external repo needed
pnpm test                    # 55 tests
```

## Layout

```
packages/schema     zod contract, no I/O
packages/extract    C# lexer, structural reader, EF fluent reader
packages/graph      invariants, degrees, shortest path, mermaid
packages/quiz       generators, grader, selftest, selection
apps/cli            hand-rolled argv
test/fixtures       self-contained EF project
```

Packages export `./src/index.ts` directly. There is no build step.
