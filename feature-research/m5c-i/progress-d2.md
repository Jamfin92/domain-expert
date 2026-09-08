# Phase D2 — M5c-i (web half): the client-call panel — PROGRESS

**Status: SHIPPED at `cd54ac2` (2026-09-08); reviewer "Ship" after one blocking
record fix; James accepted and authorised the push.** Feature commit on
`m5c-i-web`, branched from `master` at `d559b5e` (the D1 record). This record is
committed on top and `master` is fast-forwarded to it — the D1/D-A-3 shape.

Plan: `plan-d2.md` (approved as written; one line corrected mid-build, marked
in place). Audit: `audit-d2.md`. Previous phase record: `progress.md` — **whose
"What shipped" paragraph this phase superseded; it is marked as such in place.**

---

## What shipped

The Dashboard **Client calls** panel — component → call → matched route —
reading `clientCalls` and `components` from **`/graph`**, plus the first live
call site of `openInEditor` since the desktop shell landed.

| Part | Where | What |
|---|---|---|
| Endpoint decision | `apps/server/src/app.ts` | D1's `/shapes` projection **reverted** (215-220; 6 deletions, 0 insertions) |
| Server tests | `apps/server/test/api.test.ts` | D1's coverage repointed to `/graph`, not deleted: the `MINI_NODE` `[]` control moved to a new sibling `it`, the client-call-chain `describe` switched endpoint in place |
| Types | `apps/web/src/lib/api.ts` | `ClientCall` + `UiComponent`; both fields added to `EntityGraph` |
| Helper | `apps/web/src/lib/client-calls.ts` | pure `groupCallsByComponent` + `componentLabel` |
| Helper tests | `apps/web/test/client-calls.test.ts` | 12 unit tests |
| Panel | `apps/web/src/views/Dashboard.tsx` | `ClientCallList`, gated on `length > 0`, `isDesktop()`-gated editor buttons |
| Fixture | `test/fixtures/mini-fullstack-react/` | new `src/lib/save-card.ts` + an import in each `Card.tsx` |
| Fixture test | `test/mini-fullstack-react.test.ts` | the fourth call, re-derived pins, and both comment fixes |
| e2e | `e2e/harness.ts`, `e2e/psq.e2e.ts` | third fixture constant, argument-**recording** desktop stub, panel spec |

### The endpoint decision (D-D-12), and why it is not re-litigable

The panel reads from `/graph`. Evidence, all measured rather than inherited:
`/graph` is `res.json({ graph: repo.graph })` and has carried both fields since
M5a; `Dashboard.tsx` already held the whole graph in state at render time, so
the panel cost **no new fetch, no new state slot, no new loading branch**; the
only consumer of `/shapes` anywhere is `Dashboard.tsx:158`, reading
`sh.shapes`/`sh.routes` only, so the revert broke no caller; and the
colocation-with-`routes` counter-argument is hollow because `matches` is a
precomputed `"METHOD path"` string — **the panel never reads the `routes`
array at all**.

**The live-service argument, in the form that actually carries it.** The
running process has no notion of a ref: `tsx` loaded whatever was in this
working tree at `Fri Sep 4 15:05:56`, when pid 16538 started. The last commit
to change extraction of these fields, `1de65eb`, was authored
`2026-09-04 07:09:47` — eight hours earlier. `37960f2`, usually quoted as "the
Sep-4 load", was committed at 15:09:27, **after** the process started, so it is
a label for that tree, not its provenance. Consequence: D-D-10, which `plan.md`
called "the phase's main hazard", **dissolved** — the bundle this phase built
renders a working panel against the already-running server, no restart, no
deploy. Residual uncertainty, stated: uncommitted working-tree edits at
15:05:56 cannot be reconstructed, and the reviewer stopped short of a direct
read because the live service has no open repo and opening one is a write.
Blast radius is bounded either way — absent fields mean the card is not
rendered, not broken.

### The fourth call

`src/lib/save-card.ts` — a non-component helper both `Card`s import and call —
resolves through the BFS at `refs.ts:408-431` to **two** component keys, giving
two multi-call groups and exercising the `file` comparator. Probed through both
`extractNode` and `extract`, identical: `warnings` `[]`, `both` = 2,
`components` = `["src/components/admin/Card.tsx#Card",
"src/components/shop/Card.tsx#Card"]`.

**The import specifier is load-bearing and its failure is silent.** The `.js`
extension is mandatory (no tsconfig → `FALLBACK_OPTIONS`'
`moduleResolution: NodeNext`, `node.ts:29-41`; root `package.json` is
`"type": "module"`). The extensionless variant was run: `warnings` `[]`, call
still present, `components` `[]` — **no signal anywhere except the two-key
pin.** That pin, in `it("holds one row of every kind the panel renders")`, is
the only gate that catches a broken import: `both ≥ 1` stays green off the
admin call's direct-owner path, and "every key resolves" passes *vacuously* on
an empty array.

### Gates

| Gate | Baseline (`d559b5e`) | Result |
|---|---|---|
| probe, before dependent edits | — | `warnings` `[]`, `both` = 2, `components.length` = 2 |
| `pnpm typecheck` | clean | clean (all four projects) |
| `PSQ_NO_CORPUS=1 pnpm test` | 237 \| 58 (295) | **250 \| 58 (308)**, 0 failed |
| `pnpm test` | 295 | **308**, 0 failed |
| `pnpm test:e2e` | 21 | **22**, 0 failed |
| negative control (a) | — | server test fails on **`expected undefined to deeply equal []`** — on `undefined`, not a length |
| negative control (b) | — | e2e panel spec fails, card absent (`toBe(3)` received 0) |
| negative control (c) | — | dashboard still renders: the other **21** specs passed in the same mutated run and `page.on("pageerror")` (`harness.ts:117-119`) never fired |
| editor argument | — | absolute, ends `src/components/admin/Card.tsx`, line 13 |
| browser fallback | — | 5 rows, **0** editor buttons |
| grouping order | — | admin → shop → "Not attributed to a component", `no matching route` ×1 |
| line pins | — | `git show \| grep '^[-+].*line:'` prints exactly `-6/+11`, `-6/+11`, `-8/+13`, `-8/+13`, `+7` |
| `server.ts` line-count-neutral | — | **no diff line at all** for routes 25/30 |
| `dist` non-empty | — | verified, `index.html` 985 B |
| selftest | exit 0 | exit 0 on all six roots; counts match D1 (113/16/51/27/2/2) |
| corpus + token sweeps | control first | control 12/12 then 13 zero counts; tokens 2/2 then 0 |
| `git show --stat` | — | exactly the 13 paths |
| flake `api.test.ts:213` | 1 in ~13 (Phase B) | did not redden in 9 runs |

## Review history

1. **Plan critique** — verdict Ship, no blocking. It reproduced the fourth call
   in a scratchpad *before* approval (`both` = 2) and ran the extensionless
   variant to confirm the silent failure. Nine corrections folded in, including
   the `37960f2` provenance above and the landing spots for the repointed tests.
2. **Implementation review** — **one blocking, record-only**; fixed and the
   commit amended `52df02d` → `cd54ac2`.
3. **Targeted re-review** — Ship.

## The correction this phase is most worth remembering

**A false because-clause was planted in the very comment this phase was
chartered to de-falsify.** The fixture's warnings case shipped claiming
`g.warnings` is `[]` partly because "every intra-fixture import resolves (so
component attribution warns about nothing either)". False: attribution warns
about nothing *whether or not* the import resolves — `refs.ts:16-19`, an
unresolved identifier produces no edge **and no warning**. It contradicted both
the plan and this commit's own message.

The fix was made at the mechanism: every `warnings.push` reachable during node
extraction was enumerated, each clause kept only if verified. Clause 1 (no
tsconfig) survived and proved **stronger** than stated — it suppresses all
three `programFor` warnings, not one. Clause 2 (two unambiguous routes)
survived. Clause 3 was removed and replaced with the explicit statement that a
failed import is silent, naming the two-key pin as its real gate **by case
name, not line number**, so it does not go stale on the next edit.

Neither surviving clause had been checked by anyone before — plan, implementer
or first reviewer. That is the lesson: *the clause nobody challenged is not the
same as the clause that is true.*

## What the next phase needs to know

- **Carried forward from the reviews, none blocking, all deliberate:**
  - **The e2e browser fallback is folded into the tail of the desktop spec**
    (`e2e/psq.e2e.ts:442-489`). Assertions are equivalent and its `toBe(5)`
    poll is a proper positive control ahead of `toBe(0)`, so it cannot pass by
    finding nothing — but a desktop-half failure means the browser half never
    runs, and the message will not say which shell broke. Split into two `it`s
    and move the expected count to **23**. The desktop `page` is also left
    unclosed on a failing path. James deferred this to the next phase.
  - **Nothing asserts `/shapes` does NOT carry these fields.** A future
    re-projection would pass every gate in the suite.
  - **`client-calls.ts:47-49` silently drops a call whose only component key
    resolves against nothing** — it does not fall into the unattributed bucket,
    so the UI would show fewer calls than the graph holds, with no channel
    saying so. Deliberate, unit-tested at `client-calls.test.ts:117-122`, and
    unreachable today because `api.test.ts:366-372` asserts every key resolves.
  - **The reachable-warnings enumeration in `audit-d2.md` is one site short of
    exhaustive**: `pair.ts:42` is reachable from `extractNode` via
    `node.ts:191` (shared `warnings` array), making it **14** sites, not 12. It
    cannot fire here for the same reason `node.ts:204` cannot (0 shapes), and
    the shipped comment makes no completeness claim — so nothing false landed
    in the code. Recorded as one short, not as "all accounted for".
  - **The spec sits in a `describe` it does not belong to** — the last `it` in
    `"a Node backend in the browser"` (`psq.e2e.ts:398`), though it targets
    `mini-fullstack-react` and half of it runs under the desktop bridge.
    Cosmetic; `list.repos[0]` is unaffected (`Workspace.list()` sorts by name,
    `mini-efcore` stays first).
  - **The selftest byte-identity gate was not run.** Structural substitute: no
    `packages/**` path is in the commit, so no generator changed.
- **`plan-d2.md:208` was corrected mid-build** — it quoted the review probe's
  new call as `save-card.ts:1`; extraction produces **`:7`** (5-line JSDoc,
  signature at 6). Corrected in place with a dated block. The implementer's
  explanation for the discrepancy is labelled **inferred**, not measured.
- **The live service now serves this bundle.** `pnpm test:e2e` rebuilt
  `apps/web/dist`, which `com.psq.server` serves from disk per request. It was
  **not** restarted and does not need to be (above). Deploy/restart remains
  James's call (D-C-8).
- **Fixture line pins moved deliberately**: components 6 → **11**, calls 8 →
  **13**, new call at `save-card.ts:7`. `boot.ts:5` and `server.ts` routes
  25/30 unmoved. `api.test.ts` pins no line numbers for this fixture but does
  carry one **positional** pin (`both[0]`, `:351`), which survives because
  `clientCalls` sorts by file then line and `admin/Card.tsx` sorts before
  `src/lib/save-card.ts`.
- **`apps/web/test/client-calls.test.ts` is typechecked by nothing** —
  `apps/web/tsconfig.json` includes only `src/**` + `vite.config.ts`; vitest
  runs it. Same trap as D1's `api.test.ts`. Related: `client-calls.ts` imports
  its types from `@/lib/api` **type-only** on purpose — root `vitest.config.ts`
  has no `@` alias, so a value import there would fail at run time.
- Carried forward, unchanged: `repoAClient` exits 1 on selftest; drift-site id
  collisions; no Dockerfile, no CI; the corpus config is the only copy of the
  ground truth.
- **Next: Phase E (M5c-ii)**, the comparative generator — which should use
  `shapeLabel` from `@psq/quiz` for any shape it names, and reads the same two
  fields, now from `/graph`.
