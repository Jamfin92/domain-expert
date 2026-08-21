# psq — working rules

These are hard rules, not style notes. Break one and the tool stops meaning
anything.

## 1. No model ever grades an answer

Every question carries its own grader inputs: a choice index, canonical text
plus aliases, or a reference SQL query. An agent may write a question's prose.
An agent may never decide whether an answer is right.

If a generated question cannot be graded deterministically, drop it. Do not add
a model fallback.

## 2. A fact must come from the graph

Generators read `EntityGraph`. They never re-parse source and never infer a
fact at question time. If a fact is not in the graph, no question may assert it.

Add the fact to extraction first, with a test against ground truth psq did not
produce (an EF migration snapshot, a live schema).

## 3. Warn, never guess

The C# reader is deliberately partial. When it meets a construct it does not
know, it appends to `warnings` and moves on. A missing fact costs one question.
A guessed fact costs the premise of the tool.

`psq graph` prints warnings. Treat a new warning as a bug.

## 4. Mark derived facts as derived

EF supplies defaults. `deleteBehaviorSource` says whether a repo wrote a rule
(`fluent`) or whether EF implied it (`convention`). Never present a
convention-derived value as if someone had written it, and never generate a
question about one.

## 5. Every question must be failable

`psq selftest` grades each question with its reference answer, which must pass,
and with a mutation, which must fail. Run it before trusting a bank. A
generator whose questions cannot be failed is broken, not hard.

## 6. A graded query may only read

The SQL grader executes user input. It accepts a single `SELECT` or `WITH` and
nothing else — a positive allowlist, never a blacklist of dangerous keywords.
`node:sqlite` allows `ATTACH` even read-only, and silently runs only the first
of several statements, so neither can be relied on to stop anything.

This holds even though psq runs locally today. The moment it is hosted, this is
the only component that runs anything a user typed.

## 7. Determinism is a feature

Same repo, same seed, same questions in the same order. Use the seeded `rng`
from `@psq/quiz`. Never call `Math.random`. A quiz that cannot be reproduced
cannot be argued with.

## 8. Target repos are read-only

Extraction never writes into a project it reads. `.psq/` is written only on an
explicit `psq export`.

## Commands

```bash
pnpm typecheck                 # the only lint gate
pnpm test                      # hermetic
PSQ_NO_CORPUS=1 pnpm test      # hermetic, ignores local repos
pnpm psq selftest --repo <p>   # before trusting any bank
```
