# Publish scrub

Goal: make `Jamfin92/domain-expert` public without disclosing anything about the
five **private** repos it uses as a test corpus.

Terms that must not survive anywhere in the working tree **or in history**:
the five private repo names (kebab-case and PascalCase namespace forms) and
the developer's home-directory prefix. The literal list lives outside the
repo, in the gitignored replacement file used for the history rewrite.

## What leaks today

1. `test/fixtures.ts:34-38` — absolute paths naming all five private repos.
2. `packages/extract/test/node.test.ts` and the other corpus tests — ground-truth
   **table names** read from those repos' schemas, plus route counts and paths.
3. `apps/server/test/api.test.ts:49` — a home-directory absolute path (this
   repo's own, but still a home directory).
4. `feature-research/**` — the worst of it. Private API endpoints, service-layer
   file paths with line numbers, architecture descriptions
   (react-query → service → axios; WebSocket-only client).

## Design

### Corpus configuration moves out of the repo

Corpus paths and their ground-truth expectations move into a **gitignored**
`test/corpus.local.json`, read at test time. Absent → every corpus test skips
through the existing `hasCorpus` / `PSQ_NO_CORPUS` machinery, which already
works and is already exercised (155-ish skips today).

Committed code refers to corpus entries by **neutral key only** (`repoA`…`repoE`
or similar). No repo name, no path, no table name, no endpoint in any committed
file. A `test/corpus.local.example.json` documents the shape with obviously
fake values so the harness is still reproducible for a stranger.

This is the load-bearing constraint: **ground truth is data, not code.** The
corpus tests keep working on this machine and skip everywhere else.

### feature-research docs are redacted, not deleted

The reasoning in these records is the valuable part and should survive; the
identifying detail should not. Replace each private repo with a neutral
description that preserves the technical point:

- the C# + React repo → "corpus repo A, a private C# + React corpus repo"
- its endpoints/file:line → "a service module three hops from the component"
- the WebSocket-only TS repo → "corpus repo D, a private TS corpus repo with a
  WebSocket-only client"

The M5a lessons (the π divisor, the three fabricated-fact rounds, the 3-hop
finding, why no corpus repo can exercise M5) all survive redaction intact — none
of them depends on naming the repo.

### History rewrite

The terms are spread across earlier commits too (the drift-oracle and M9 records
predate this session), so scrubbing the tip is not enough. Use `git filter-repo
--replace-text` with a replacement list covering every term above, then
force-push.

`--replace-text` is content-level and will hit prose as well as code, which is
what we want. It rewrites every commit hash from the first offending commit
onward.

**Safe here because:** the repo is private, solo, has no forks or PRs, and no
other clone exists. Confirm all four before rewriting.

### License

Add `LICENSE` — MIT, `Copyright (c) 2026 James Finlay`. MIT keeps future
releases relicensable at will; it cannot retract rights from versions already
published, and no OSI-approved license can.

## Files touched

| file | change |
| --- | --- |
| `test/fixtures.ts` | corpus paths → read from gitignored local config; neutral keys |
| `test/corpus.local.example.json` | **new** — documented shape, fake values |
| `.gitignore` | ignore `test/corpus.local.json` |
| `packages/extract/test/node.test.ts` | ground truth → local config; neutral keys |
| any other corpus test | same treatment — find them all |
| `apps/server/test/api.test.ts` | absolute path → computed from repo root |
| `feature-research/**` | redact per above; keep the reasoning |
| `LICENSE` | **new** — MIT |
| `README.md` | note the corpus config requirement if it documents testing |

## Verification

- All four gates, corpus **ON** (this machine has the corpus, so the tests must
  still run and pass, not silently skip): `pnpm typecheck`, `pnpm test`,
  `PSQ_NO_CORPUS=1 pnpm test`, `pnpm test:e2e`.
- **Prove the corpus tests still run**: the corpus-on run must report the same
  test count as before the scrub (211 passed). A drop means they went to skipped
  and the ground truth was lost rather than moved.
- **Prove the skip path works**: temporarily move `test/corpus.local.json` aside
  and confirm the suite passes with corpus tests skipped, then restore it. That
  is what a stranger cloning the public repo will experience.
- After the rewrite, `git log --all -p | grep -iE '<each term>'` must return
  **nothing**. Check the working tree and full history separately.
- `git log --oneline` still shows a sensible history.

Do not force-push or change visibility as part of implementation — the
orchestrator verifies the grep results first.
