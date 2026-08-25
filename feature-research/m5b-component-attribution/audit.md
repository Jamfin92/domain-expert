# M5b audit — component attribution + programFor project-reference resolution

FINAL (round 5, post-SHIP fold-in). Three small items after the SHIP verdict:
the sibling-count off-by-one (namedMemberCount excluded exactly the members
round 3 drops, so one named + one computed member read as single-member and
fanned out — fixed to count ALL properties, pinned by the mixedStore fixture
case), the single-member catalogue entry restated in the terms that are true
(no siblings to fan across — NOT that every referrer reaches the call), and
the edge residual quantified on the corpus (numbers below).

Round 4. Two further blocking fixes, both in the same defect family: the
constructor exception (the one arm round 3 left walkable, on a justification
a probe falsified) and the sibling-bearing containers the round-3 arm table
filed under "by design" (the fifth instance). The arm table is retitled and
rebuilt below — its round-3 heading claimed completeness over the language
while enumerating only the arms written in collectDefs, and that phrasing
concealed the live defect.

Round 3. The round-2 blocking fixes were verified by the reviewer; this round
fixed ONE further blocking issue — the same defect class as round-2 blocker
#3, one AST node over, the FOURTH instance of the pattern this phase — plus
five non-blocking items. The sweep the reviewer demanded (every arm where a
node is skipped as a definition while still able to contain a call) is
enumerated below, and inventory items 4 and 5 are rewritten from the probed
code paths.

Round 2. The first review returned FIX FIRST with three blocking issues — all
three the M5a pattern (a confident answer where a skip was correct), and all
three survived my green suite and my own "answer-vs-skip" inventory, which was
therefore incomplete. This audit is rebuilt after the fixes; the "what I got
wrong" section is at the end.

## Files changed

**New**
- `packages/extract/src/node/refs.ts`
- `test/fixtures/mini-react/tsconfig.json`
- `test/fixtures/mini-react/tsconfig.app.json`
- `test/fixtures/mini-react/tsconfig.node.json`
- `test/fixtures/mini-react/vite.config.ts`
- `test/fixtures/mini-react/src/lib/schema.ts`
- `test/fixtures/mini-react/src/lib/boot.ts`
- `test/fixtures/mini-react/src/lib/refresh.ts`
- `test/fixtures/mini-react/src/lib/format.ts`
- `test/fixtures/mini-react/src/lib/cycle.ts`
- `test/fixtures/mini-react/src/services/things.service.ts`
- `test/fixtures/mini-react/src/services/status.service.ts`
- `test/fixtures/mini-react/src/services/api.ts`
- `test/fixtures/mini-react/src/services/index.ts`
- `test/fixtures/mini-react/src/hooks/use-status.ts`
- `test/fixtures/mini-react/src/components/StatusPanel.tsx`
- `test/fixtures/mini-react/src/components/ThingList.tsx`
- `test/fixtures/mini-react/src/components/ThingRemover.tsx`
- `test/fixtures/mini-react/src/components/HomePage.tsx`
- `test/fixtures/mini-react/src/components/AccountMenu.tsx`
- `test/fixtures/mini-react/src/components/SchedulerPanel.tsx`
- `test/fixtures/mini-react/src/services/exotic.service.ts`
- `test/fixtures/mini-react/src/services/store.ts`
- `test/fixtures/mini-react/src/components/StorePanel.tsx`
- `test/fixtures/mini-react/src/components/MutatingPanel.tsx`
- `test/fixtures/mini-react/src/components/ExoticPanel.tsx`
- `test/fixtures/mini-react/src/components/UserList.tsx`
- `test/fixtures/mini-react/src/components/UserFinder.tsx`
- `test/fixtures/mini-react/src/components/admin/Card.tsx`
- `test/fixtures/mini-react/src/components/shop/Card.tsx`
- `test/fixtures/mini-react/src/components/ui/Button.tsx`
- `test/fixtures/mini-react/src/providers/session-provider.tsx`
- `test/fixtures/mini-solution-tie/tsconfig.json`
- `test/fixtures/mini-solution-tie/tsconfig.a.json`
- `test/fixtures/mini-solution-tie/tsconfig.b.json`
- `test/fixtures/mini-solution-tie/a.ts`
- `test/fixtures/mini-solution-tie/b.ts`
- `test/mini-react.test.ts`

**Modified**
- `packages/extract/src/node.ts`
- `packages/extract/src/node/clients.ts`
- `packages/schema/src/index.ts`
- `packages/extract/src/detect.ts`
- `packages/extract/src/dotnet.ts`
- `packages/graph/test/layout3d.test.ts`
- `packages/extract/test/node.test.ts`
- `test/fixtures.ts`
- `test/mini-fullstack.test.ts`
- `tsconfig.json` (root — mini-react and mini-solution-tie excludes)
- `README.md`

**Modified, gitignored (never committed)**
- `test/corpus.local.json` — `repoAClient` entry with hand-verified `componentChains`

Nothing was committed. No name from the private repo appears in any committed
file (re-grepped after the fix round).

---

## What changed per file

### `packages/extract/src/node.ts` (Part 1)
- `pickReferencedProject(repoRoot, parsed)`: resolves each project reference
  (`ts.resolveProjectReferencePath`, basePath = the referenced config's own
  directory, one level, options verbatim) and selects the winner by the count
  of files **under the repo root** — the same predicate `ownSources` applies
  afterwards (in-root, no node_modules, no .d.ts). A reference contributing
  zero in-repo files cannot win, however many out-of-root files it parses to
  (blocking fix 1). Tiebreak: explicit lexicographic `<` on config path.
- Dropped-reference warning (`N referenced projects; reading only <winner>`)
  — since round 3 it fires only when MORE THAN ONE reference actually
  contributed in-root files, so one real project plus one out-of-root
  reference no longer claims something readable was dropped (probed: no
  warning, the real project read). This restored the warning-tracks-a-drop
  lockstep that round-2's in-root counting had broken.
- The ownCount comment states the predicate is a conservative APPROXIMATION
  of ownSources (`.d.ts` suffix vs `isDeclarationFile`, config fileNames vs
  whole program with transitive imports), both differences undercounting
  only — an undercount can push a reference toward the warned fall-through,
  never crown a winner whose in-root read is empty.
- Fall-through warning ("tsconfig.json names no files and no referenced
  project contributes files under this directory; falling back to a directory
  scan with default compiler options") — `else`-arm of the `read.error`
  branch, unreachable without a tsconfig, and now also covering the
  out-of-root-reference case, which then degrades to `walk()` and still finds
  in-repo calls (probe below).
- `jsx: ts.JsxEmit.Preserve` in `FALLBACK_OPTIONS`.
- Wiring: call-node map threaded through `readClientCalls`;
  `attributeComponents` runs LAST; `components` on the graph.

### `packages/extract/src/node/refs.ts` (new, Part 2)
- Definitions at SourceFile scope, indexed by the canonical declaration node
  (`valueDeclaration ?? declarations[0]`); object-literal members qualified by
  their holder chain **recursively** (blocking fix 2): in
  `const api = { users: { list() {} } }`, `api.users.list` is its own
  definition, so a call in `list` cannot fan out through `api.users` to every
  caller of every sibling.
- Collision: first wins, warning names both sites, and the loser's canonical
  node is recorded in a `dropped` set. `ownerDef` returns **null** when the
  ancestor walk crosses a dropped node (blocking fix 3): a call inside a
  collision loser is unattributed, never handed to the enclosing class/object
  and fanned out from there. Edges into or out of a dropped declaration do not
  exist (it is not indexed, and its interior has no owner).
- `Component.file` and `.line` (and the key's file half) all derive from the
  canonical node's own source file, so they can never disagree (fix 8).
- **Round 3 (blocking):** `dropped` extended to every construct skipped as a
  definition while still able to contain a call: object-literal members with
  computed keys, spreads and accessors; unindexed class-declaration members;
  class EXPRESSIONS whole. `as`/`satisfies`/parenthesized object initializers
  are unwrapped so their members index normally, and a default-exported
  object literal indexes its members as `default.<name>`.
- **Round 4 (blocking):** (1) the constructor exception is REMOVED — every
  non-method class member is dropped. "Its body runs exactly when the class
  is used" is false for a type annotation, `instanceof`, a static access or
  `extends`, and the edge walk cannot tell any of them from `new`; a
  type-only importer owned the constructor's calls. (2) `owningDefForCall`
  implements the reviewer-decided sibling-bearing rule for CALL attribution:
  a call whose ownership walk crossed an unindexed sibling-bearing container
  (object literal with ≥2 named members, or array literal with ≥2 elements —
  the array reading is required by the probe's handler-array case) is
  refused a NON-COMPONENT owner and comes out []; a COMPONENT owner is kept,
  preserving the corpus's most common correct attribution (a fetch inside a
  component's own options object). The rule is deliberately NOT applied to
  reference-edge resolution: a hook's `useQuery({ queryFn: svc.method })`
  reference is genuinely the hook's — its body executes it — and refusing it
  would sever every hook-mediated chain (all the corpus 3-hops). Residual,
  catalogued: a REFERENCE from inside such a container still yields an edge
  from the enclosing definition, so one-hop-removed fan-out through that
  edge remains possible; fixing it means severing hooks, so it stays a
  documented limitation rather than a guess either way.
- **Round 5:** `isSiblingBearing` counts ALL object properties, not just
  indexable-named ones. The old count treated the same construct two ways by
  position: a computed-key member was DROPPED when its literal was indexed,
  yet permitted to fan out when the identical literal sat inside a factory
  call (it read as single-member). The predicate answers "are there
  siblings", not "are there indexable siblings". Pinned: `mixedStore` (one
  named + one computed member) — `/api/mixed/named` and `/api/mixed/computed`
  both `[]` with StorePanel referencing the variable; both fanned out before
  the fix. Reviewer-verified that no existing assertion changes (the
  MutatingPanel options object already had two named members; the exotic
  service goes through the indexed/dropped path).
- Everything else as round 1: alias-following edges carrying the referencing
  node, innermost `ownerDef`, reverse BFS stopping at the first component,
  `visited`, silent depth cap 8, pluggable `ComponentDetector` with
  JSX+PascalCase as detector #1, file filter identical to `readClientCalls`.

### `packages/extract/src/node/clients.ts`
- `readClientCalls`: optional `callNodes` out-map; `components: []` initialised
  and always overwritten by attribution.
- `enclosingName`: object-literal arrow properties, class property arrows,
  constructors ("constructor"), get- **and set-**accessors (fix 9), anonymous
  default exports ("default"). Every pinned mini-fullstack value unchanged.

### `packages/schema/src/index.ts`
`Component`, `EntityGraph.components`, `ClientCall.components` (sorted keys),
and the attribution miss list — now also cataloguing (fixes 4, 5): an
anonymous `export default` keys as "default" and can never pass the PascalCase
test, so an anonymous default-exported component is undetectable; and a class
component's own calls stay unattributed because no reference edge connects a
class's methods to the class. The collision bullet now describes what the code
does: the loser's declaration is recorded and ownership walks stop at it.
Round 3 adds three bullets: calls inside non-definition members (computed
keys, spreads, accessors, unindexed class members, class-expression members)
are dropped and never spill to the holder; an overloaded function's canonical
declaration is its bodiless first signature, so an overloaded component is
undetectable and its implementation's calls are unattributed; and member keys
do not escape `.`, so `{ "a.b": x }` vs nested `a: { b: y }` is an honest
warn-and-drop collision.

### Construction sites, fixtures, tests
- `components: []` at the three non-node `EntityGraph` construction sites
  (detect.ts, dotnet.ts x2, layout3d.test.ts helper) — set verified complete
  by grepping `kind: "entity"`.
- `test/fixtures/mini-react/`: as round 1, plus a **second reference**
  (`tsconfig.node.json` holding only `vite.config.ts`) so largest-wins and the
  dropped-reference warning are exercised hermetically (fix 6); a **nested
  grouped client** (`src/services/api.ts`) with `UserList`/`UserFinder` each
  touching one member (pins fix 2); and the **collision loser now owns a
  call** with `SchedulerPanel` referencing the class (pins fix 3 — the call
  must come out `[]`, not `[SchedulerPanel]`).
- `test/fixtures/mini-solution-tie/` (fix 6): two referenced projects with
  EQUAL file counts declared in REVERSED order — only the explicit `<`
  tiebreak can pick `tsconfig.a.json`; the test asserts the warning names it
  and only `/api/a` is read. **Scope addition, recorded as such:** this
  fixture (and `MINI_SOLUTION_TIE` in `test/fixtures.ts`, and its root
  tsconfig exclude) is outside the plan's Files-touched list; it exists
  because review round 2 item 6 required committed multi-reference coverage.
- Round-3 pins: `src/services/exotic.service.ts` + `ExoticPanel` (a computed
  key, an accessor, and a spread member each holding a call — all three come
  out `[]` while the plain sibling attributes to ExoticPanel only);
  `refresh.ts` gains a class property arrow (`/api/poll` → `[]`) and a class
  expression (`/api/klass` → `[]`) with `SchedulerPanel` referencing both
  holders, proving no spill.
- Round-4 pins, both sides of the sibling-bearing rule as required:
  `src/services/store.ts` + `StorePanel` (factory-argument object with two
  methods; `/api/store/a` and `/api/store/b` → `[]` even though StorePanel
  references the variable) and `MutatingPanel` (a fetch inside a two-member
  options object owned by the component → `[MutatingPanel]` — the committed
  regression guard for the corpus feedback-card attribution). Plus the
  constructor pin: `RefreshScheduler` gains `constructor() { fetch("/api/ctor") }`
  with `SchedulerPanel` doing `new RefreshScheduler()`, and `/api/ctor` → `[]`.
- `test/mini-react.test.ts`: exhaustive `toEqual` over warnings (now two:
  dropped reference + collision), components and calls, with ABSENT-on-purpose
  comments; plus the tiebreak describe.
- `packages/extract/test/node.test.ts`: the `componentChains` test is
  `it.skipIf(!repoAClient?.expect.node?.componentChains)` so a corpus entry
  without the pin skips instead of throwing mid-run (fix 7).
- README: M5b row is "component attribution (done), route↔table link (next) —
  in progress", and the Next item is numbered "M5b (rest)" (fix 10).

**Fixture revert check** (unchanged from round 1, still true): with the
solution tsconfig hidden, `/api/status`, `/api/things` and the DELETE lose
their components — the suite goes red if Part 1 is reverted.

---

## Deviations from the plan (carried from round 1, all reviewer-confirmed)

1. DefKey: object-literal members qualified (`file#svc.getX`, now recursively
   `file#api.users.list`), class methods unqualified — forced by the committed
   mini-fullstack zero-warning contract (`api.get` vs `bus.get`) and the
   plan's own collision example. Reviewer confirmed correct.
2. Dropped-reference warning fires at 2+ references (plan's prose said 3+; its
   message format is generic and a 2-ref Vite drop is a real drop).
3. README edit extends one sentence beyond "the row" (kept consistent with the
   row; now numbered per fix 10).
4. `test/corpus.local.json` filled by me (gitignored; reviewer confirmed).
5. Defensive warning in `attributeComponents` for a call with no recorded AST
   node (unreachable today) — "attribution could not run" must not look like
   "no owner".

New in round 2 (beyond the review's explicit instructions):
`test/fixtures/mini-solution-tie/` + `MINI_SOLUTION_TIE` + its root-tsconfig
exclude are outside the plan's Files-touched list — a scope addition made
because review item 6 required committed multi-reference coverage; recorded
here as such. Everything else in rounds 2 and 3 maps to a numbered review
item. Round 3's deviation-#2 restatement: the dropped-reference warning now
fires on "more than one reference contributed in-root files", which restores
the lockstep the original deviation claimed.

---

## Verification (actual output, after the fix round)

- `pnpm typecheck` — clean (root, e2e, @psq/web, @psq/desktop). (Final
  re-run after the round-5 fold-in.)
- `pnpm test` (corpus ON) — **219 passed (219)** (rounds 3–5 extend existing
  exhaustive assertions rather than adding tests). Round-1 baseline 217,
  pre-M5b baseline 211 — never below 219 since round 2.
- `PSQ_NO_CORPUS=1 pnpm test` — 161 passed, 58 skipped (219).
- `pnpm test:e2e` — **19 passed (19)** (final re-run).
- Corpus aggregate confirmed unchanged after round 5: 50 calls, 201
  components, 6 empties, max list 12, 2 warnings (full per-call diff against
  round 4: empty).
- All four `expect(g.warnings).toEqual([])` contracts hold
  (test/mini-node.test.ts:18, test/mini-fullstack.test.ts:18,
  packages/extract/test/node.test.ts:95, e2e/psq.e2e.ts:67 — the first two and
  the fourth are hermetic and inside the green runs above; the third ran green
  in the corpus-ON run).

### Probes for the three blocking fixes

1. **Out-of-root reference** (the reviewer's probe shape:
   `client/tsconfig.json = {"files":[],"references":[{"path":"../shared"}]}`
   plus a real `client/local.ts` with `fetch("/api/client")`): now warns
   ("...no referenced project contributes files under this directory; falling
   back to a directory scan...") and the walk fallback records
   `GET /api/client`. Before the fix: zero warnings, zero calls.
2. **Nested grouped client** (mini-react `src/services/api.ts`):
   `/api/users` → `[UserList]` only, `/api/users/*` → `[UserFinder]` only.
   Before the fix both calls carried both components.
3. **Collision loser owning a call** (mini-react `src/lib/refresh.ts` +
   `SchedulerPanel`): `/api/refresh` → `[]`. Before the fix it attributed to
   `SchedulerPanel` through the class.
4. **Tiebreak**: `mini-solution-tie` reads only `a.ts` (`/api/a`), warning
   names `tsconfig.a.json`, with the losing project declared first.

### Probes for the round-3 fixes

5. **Non-definition members** (the reviewer's probe shape, committed as
   `exotic.service.ts`): `/api/exotic/plain` → `[ExoticPanel]`;
   `/api/exotic/computed`, `/api/exotic/accessor`, `/api/exotic/spread` →
   `[]` each. Before the fix all four spilled to the object's referencers.
   Same for the class property arrow (`/api/poll` → `[]`) and the class
   expression (`/api/klass` → `[]`) with `SchedulerPanel` referencing both.
6. **Warning lockstep**: a solution config with one real in-root project plus
   one out-of-root reference produces NO dropped-reference warning and reads
   the real project (`GET /api/main` found, warnings `[]`). The round-2
   out-of-root probe still warns and still finds `GET /api/client` via the
   fallback.

### Probes for the round-4 fixes

7. **Constructor**: `/api/ctor` (in `RefreshScheduler`'s constructor, with
   `SchedulerPanel` constructing it) → `[]`. Before the fix the reviewer's
   probe attributed a constructor's call to a component that referenced the
   class only as a type.
8. **Sibling-bearing containers**: `/api/store/a`, `/api/store/b` → `[]`
   (was: both fanned out to the variable's referencers); `/api/mutate` →
   `[MutatingPanel]` (the component-owner side, unchanged by the rule — the
   regression guard). Both committed as fixture assertions, not just probes.

### Probe for the round-5 fix

9. **All-properties sibling count**: `mixedStore` (one named + one
   computed-key member inside a factory call) — both `/api/mixed/named` and
   `/api/mixed/computed` → `[]` with StorePanel referencing the variable;
   under the named-members-only count the literal read as single-member and
   both fanned out. Committed as fixture assertions.

### Part 1 gate (from round 1, unchanged)

Against the real client, the chosen project is `tsconfig.app.json` (222
files); `countyService` → VariableDeclaration and `getCounties` →
MethodDeclaration in `src/services/county.service.ts`.

---

## Falsification run — repoA/client (re-run after fixes 1–3)

**Byte-identical across rounds 1–4** (each round's full per-call output
diffed against the previous: empty). Per the reviewer's instruction this is
EXPECTED and is NOT evidence the round-4 fixes work — the repo contains none
of these shapes (no constructor holds a call, its services are flat direct
initializers, not factory products); the committed fixture pins are the
evidence. 50 calls, 201 components, the same 6 empty
attributions, the same 12-element maximum list, same warnings (2 referenced
projects + no-CREATE-TABLE). No attribution moved. That is the expected
outcome, verified rather than assumed: this repo has no key collisions (no
collision warning fires), no nested grouped clients (its services are flat
object literals — the recursion adds dotted defs only where nesting exists),
and its tsconfig references resolve in-repo (fix 1 changes winner selection
only when references contribute out-of-root files). Round 3 also moved
nothing: the repo's services are flat object literals with plain named
methods — no computed keys, spreads, accessors, class members or class
expressions hold any of the 50 calls, and its two references both contribute
in-root files, so the warning still fires and is still accurate.

- Depth distribution: 21 components at depth 1, 72 at depth 2, 30 at depth 3;
  the cap never truncated.
- Worked examples (hand-verified in source, unchanged):
  - direct-in-component: `feedback-card.tsx:56` → `FeedbackCard`.
  - 2-hop: `demo-seed.ts:108..177` (`seedRenewalStage`) → `DemoLauncherPage`
    via `demo-launcher-page.tsx:26`. **Known fact #1 correct.**
  - 3-hop: `county.service.ts:6` → RegisterPage / CountySelectPage /
    WelcomePage / ProfileForm via the bare `queryFn: countyService.getCounties`
    in `use-counties.ts:7`.
  - 4-hop: `application.service.ts:24` → the 11 wizards at depth 3, via
    `useCreateApplication` (`use-applications.ts`) ←
    `useApplicationWizard` (`_shared/use-application-wizard.ts:45`) ← each
    wizard `index.tsx`.
  - provider: `auth.service.ts:10/15/27` → `AuthProvider` in
    `features/auth/auth-context.tsx`; consumers absent (the swallow).
    **Known fact #2 correct.**
- Every empty result, explained (all re-verified):
  1. `src/lib/axios.ts:28` — module-scope interceptor callback.
     **Known fact #3 correct — genuinely unattributed.**
  2. `application.service.ts:17` — only referenced by `useApplication`, which
     no file uses. Dead hook.
  3. `application.service.ts:47` — zero references. Dead code.
  4. `auth.service.ts:20` — zero references (the interceptor calls raw
     axios). Dead code.
  5. `county.service.ts:26` — zero references. Dead code.
  6. `user.service.ts:17` — zero references. Dead code.
- Largest list: 12 (`/applications/*/pdf` via `openPdfInNewTab`): 11 wizards
  through the shared wizard hook + `ApplicationListPage` calling directly.
  Plausible and hand-confirmed.

---

## Every place the code produces an answer rather than a skip (rebuilt)

The round-1 inventory missed all three blocking cases. Each entry below now
states the guard that makes the answer provable, and the three misses are
marked.

1. **`programFor` root-tsconfig branch** — answers only when the root config
   itself yields files.
2. **`pickReferencedProject` winner** — answers only when a reference read
   cleanly, parsed, AND contributes ≥1 file under the repo root by the same
   predicate `ownSources` applies later. *(ROUND-1 MISS #1: the old guard was
   "parsed to ≥1 file", which is satisfiable entirely by out-of-root files —
   the winner's whole program was then filtered away downstream, silently. The
   guard now proves the downstream read is non-empty.)* If no reference
   qualifies, the fall-through WARNS and the walk fallback still reads in-repo
   source. Dropped siblings are named in a warning.
3. **`FALLBACK_OPTIONS.jsx`** — near-no-op; not treated as evidence.
4. **Definition keying** — only provably named bindings at SourceFile scope
   (plus the anonymous default, whose "default" name is the fact TS itself
   assigns). For every construct NOT indexed, the entry below states what
   happens to a CALL inside it — "skipped" alone was the round-1 and round-3
   failure shape:
   - computed-key / spread / accessor object members, unindexed class
     members, class expressions: the node is in `dropped`, `ownerDef`
     returns null at it, the call is `[]`. *(ROUND-3 MISS: these were
     "skipped" without a drop, so `ownerDef` walked to the holding
     object/class and the call fanned out to every component touching any
     sibling — the fourth instance of the spill class this phase, one AST
     node from the third.)*
   - destructured VariableDeclarations (`const { a } = init`): not indexed,
     and there is no outer definition at statement level, so a call in
     `init` walks to the SourceFile and comes out null → `[]`. No spill
     possible by position.
   - collision losers: dropped (round 2), call `[]`.
   *(ROUND-1 MISS #2, retained for the record: object-literal qualification
   stopped at one level; a nested member's calls belonged to the whole group.
   Qualification now recurses.)*
5. **Canonical node** — `valueDeclaration ?? declarations[0]`; where no
   symbol exists (anonymous default, shorthand property) the visited node IS
   the canonical declaration. `file`/`line`/key-file all derive from the
   canonical node, so they cannot disagree. For an OVERLOADED function the
   canonical node is the first SIGNATURE, which is bodiless — probed, not
   assumed: the detector finds no JSX in a signature (an overloaded component
   is absent from components[]), and a call in the implementation body finds
   no indexed ancestor (the implementation node is not the canonical one) and
   walks to the SourceFile → null → `[]`. A skip both times, never a wrong
   answer, and no spill is possible because overloads exist only at statement
   level. The round-2 comment claimed overloads "collapse onto one canonical
   implementation" — written from intent; corrected. Catalogued on the
   schema.
6. **Collision** — first wins with a warning naming both sites; the loser is
   un-indexed AND recorded as dropped, and `ownerDef` returns null on crossing
   it. *(ROUND-1 MISS #3: un-indexing alone let `ownerDef` walk past the loser
   to the enclosing class/object — the schema promised "unattributed rather
   than mis-attributed" while the code attributed at class granularity. The
   promise is now implemented, not just written.)*
7. **Edges** — only when the checker resolves, the alias chain terminates in a
   real declaration, in-root, not `.d.ts`, and indexed. Any failure: skip.
8. **Call ownership (`owningDefForCall`)** — answers only for an indexed
   ancestor; null at module scope, null past a dropped declaration, and null
   when a sibling-bearing container was crossed and the found owner is not a
   component (round 4). A component owner is answered even across such a
   container because the BFS stops at it immediately — the answer names the
   component whose body lexically contains the call, which is provable.
   Reference-edge resolution (`ownerDef`) deliberately omits the sibling
   check — a hook genuinely owns the references its body executes — leaving
   the catalogued one-hop-removed residual.
9. **Component detection** — PascalCase AND JSX, both required; each alone is
   a catalogued miss (including, explicitly now, the anonymous-default and
   class-component cases).
10. **BFS** — records only components reached along real edges; first-component
    stop and depth-8 cap are documented misses, not answers.
11. **`enclosingName`** — returns only names written at the binding site;
    set-accessors now handled so they cannot pick up an outer name.
12. **`components: []` init** — never a finding; attribution assigns every
    call, and the unreachable no-node path warns.

## The spill sweep: every arm reached by collectDefs, plus the containers it never reaches

(Retitled in round 4. The round-3 title claimed "every arm that skips a
potential call container"; it enumerated the arms WRITTEN IN collectDefs, not
the containers that exist in the language — which is exactly where the
round-4 blocking case and the namespace case were hiding. A completeness
claim that is not true is worse than an honest gap.)

Rule applied: a construct that is skipped as a definition but can contain a
call must be DROPPED (ownership walk stops, call `[]`), refused by the
sibling-bearing rule, or provably have no outer definition to spill to.

**Arms reached by collectDefs:**

| Arm | Can hold a call? | Disposition |
|---|---|---|
| Object member: computed key | yes | **dropped** (round 3) |
| Object member: spread | yes (inline object's methods) | **dropped** (round 3) |
| Object member: get/set accessor | yes | **dropped** (round 3) |
| Object member: other name kinds (numeric, private) | yes | **dropped** — same else-arm (round 3) |
| Class member: property declaration (arrow or any initializer) | yes | **dropped** (round 3) |
| Class member: accessor / computed-name method / static block | yes | **dropped** (round 3) |
| Class member: constructor | yes | **dropped** (round 4) — the round-3 "walkable, the class is its provable owner" justification was FALSE: type annotations, `instanceof`, static access and `extends` reference a class without constructing it, and the edge walk cannot tell them from `new`; pinned by `/api/ctor` → `[]` with a constructing component present |
| Class expression (variable initializer or default export) | yes | **dropped whole** (round 3) |
| Collision loser | yes | **dropped** (round 2) |
| Destructured VariableDeclaration | yes (initializer) | not dropped: no outer definition exists at statement level — `[]` by position |
| Overload signatures / implementation | yes (implementation) | not dropped: canonical is the bodiless signature, nothing to spill to at statement level — `[]` by position; catalogued |
| `as` / `satisfies` / parens around an object initializer | yes | **unwrapped** (round 3) so members index normally |
| Default-exported object literal | yes | members indexed as `default.<name>` (round 3) |

**Containers collectDefs never reaches** (the round-3 table's last row filed
these under "by design", conflating ANONYMITY with the real discriminator,
SIBLING-BEARING):

| Container | Disposition |
|---|---|
| Object literal inside a factory call / factory arrow return / IIFE; array of handler objects — ≥2 named members or ≥2 elements | **sibling-bearing rule** (round 4): a NON-COMPONENT owner is refused, call `[]`; pinned by `store.ts` (`/api/store/a`, `/api/store/b` → `[]` with `StorePanel` referencing the variable) |
| The same shapes with a COMPONENT owner (a fetch in a component's `useMutation({ mutationFn, ... })` options object) | attributed to the component — its genuine owner, BFS stops immediately, no fan-out exists; pinned by `MutatingPanel` (`/api/mutate` → `[MutatingPanel]`), the regression guard for the corpus's feedback-card attribution |
| Single-member anonymous containers (`forwardRef(cb)`, `mk({ only(){...} })`) | attributed to the enclosing definition — a DECISION, stated in the terms that are true: accepted because there are NO SIBLINGS to fan across, not because every referrer provably reaches the call (a `typeof solo` referrer is still counted an owner; probed by the reviewer). Catalogued on the schema in these terms |
| Class heritage / decorator expressions (`class A extends mixin({...})`, `@dec({...})`) | children of the ClassDeclaration, not of a member: when the embedded container is sibling-bearing the round-4 rule refuses the class as owner (falls out of the same walk); a SINGLE-member container there still attributes to the class — same single-purpose argument as forwardRef, catalogued |
| Namespaces (`ModuleDeclaration`) and `export =` | safe by position (probed by the reviewer: a call in a namespace function → `[]` — namespace statements are not SourceFile statements, so nothing inside is indexed and nothing outer exists to spill to), but everything inside a namespace is INVISIBLE to attribution — now catalogued on the schema |
| Reference edges from inside a sibling-bearing container | NOT covered by the rule, deliberately: applying it to edges would sever every hook-mediated chain (`useQuery({ queryFn: svc.method })`). Residual one-hop-removed fan-out through such an edge is a documented limitation — QUANTIFIED on the corpus (round 5, by temporary instrumentation, since removed): 1073 distinct edges originate inside a sibling-bearing container under a non-component owner, of which 897 sit in product position (returned/initializer value) — but only 2 of those (one source line: a hook building react-query descriptors inside a `.map`, references to one service object and its method) target a definition that owns a client call, and hand-inspection shows that site is the options shape the hook itself executes, with a single consumer that genuinely triggers the call: attribution there is CORRECT. The mis-attributing shape the reviewer constructed (a returned multi-member object of service references with member-selective consumers) occurs ZERO times in the corpus. The other 895 product edges target demo/tour data constants owning no calls; the 176 argument-position edges are the options-object shape the rule deliberately preserves (51 of them call-bearing — the hook chains). The residual is bounded by evidence: no call in the corpus is mis-attributed through it today |

## What I got wrong in round 1

- I treated "skipped unreadable/empty references" as covering all degenerate
  references; an out-of-root reference was neither, and I introduced a silent
  empty read strictly worse than pre-diff behaviour while claiming the
  opposite in the inventory.
- I implemented the innermost-ownerDef rule at exactly the nesting depth the
  fixture exercised and no further, then cited the flat fixture as evidence.
  The fan-out the plan named was alive one level down.
- I wrote a schema guarantee ("stay unattributed rather than mis-attributed")
  from the design intention instead of from the code path, and the inventory
  repeated the claim without probing it.
- The common thread: the round-1 inventory was written from what the code was
  meant to do. This one was rebuilt by probing each entry (the probes above
  are committed as fixture cases or reproduced in this audit).

And in round 2:
- I fixed the spill for collision losers and did not ask where else the same
  shape existed — the fix introduced `dropped` and applied it to exactly one
  of the arms that needed it. The round-3 sweep table above is the answer
  that question should have produced then.
- I wrote the overload comment ("collapse onto one canonical implementation")
  from intent again, in the same round whose audit claimed that habit was
  corrected. The claim is now probed and the comment states what the checker
  actually returns.

And in round 3:
- I granted the constructor an exception on an argument I never probed ("its
  body runs exactly when the class is used") — false for every non-`new`
  reference to a class, which the edge walk cannot distinguish. The only
  exception in the arm table was also its only fabrication.
- I titled the sweep "every arm that skips a potential call container" while
  enumerating only the arms collectDefs contains, and filed the containers it
  never reaches under "anonymous sub-expressions … by design". The real
  discriminator is SIBLING-BEARING, not anonymity; conflating them let the
  fifth instance of the spill class survive a sweep that claimed
  completeness. The table is now titled by what it actually covers and lists
  the never-reached containers separately.

## Open risks

- Dropped-reference warning appears for every 2-project Vite client psq reads;
  accurate, but a future zero-warning corpus expectation must account for it.
- Class-method keys are unqualified (per the plan's collision example): two
  same-named methods on two classes in one file collide and warn, and the
  second class's method-owned calls become unattributed. Loud, not wrong.
- `enclosing` "constructor" does not say which class; display-only.
- A collision loser's interior is invisible to the edge walk (its calls are
  unattributed AND references from inside it create no edges). This is the
  designed skip; if it proves too lossy the fix is qualified class-method
  keys, which the plan deliberately did not choose.
