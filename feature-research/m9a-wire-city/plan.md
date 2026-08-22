# M9a — wire the entity city into the web UI

M9 was one plan; a review split it. This is the first half: make the city
**render**, keeping the existing hardcoded grey palette exactly as it is.
Theme-derived colours are M9b (`../m9b-theme-colours/plan.md`) and nothing here
touches colour.

The split exists because M9b has a real unresolved design question — the obvious
theme tokens produce a white-on-white city in light mode — and shipping this
half first makes that problem *visible on screen*, so it can be answered by
looking rather than guessed at.

## Context the implementer should not have to rediscover

- **No server work.** `GET /api/repos/:id/layout3d` already exists
  (`apps/server/src/app.ts:105-112`) and the typed client binding
  `api.layout3d(id)` already exists (`apps/web/src/lib/api.ts:175`), returning
  `{ layout3d: Layout3D }`. Nothing calls either. The `Layout3D` type is
  hand-mirrored at `api.ts:49-55` and is already correct.
- **`EntityCity` is complete and imported by nothing**
  (`apps/web/src/components/EntityCity.tsx:84`). Props are
  `{ layout: Layout3D, fallback: React.ReactNode }`. It renders on mount, on
  `ResizeObserver`, and when its `useLayoutEffect` deps change; there is no
  animation loop. Its teardown (`:206-213`) has been reviewed and correctly
  disposes renderer, context and geometries — do not "improve" it here.
- **`apps/web` takes no workspace deps** by design (`api.ts:33-34`). Do not add
  `@psq/graph`.
- **There is no router.** `App.tsx:161-188` is `useState` conditionals. Do not
  add one.
- **No jsdom, no component tests.** Root `vitest.config.ts` is
  `environment: "node"`, include `apps/*/test/**/*.test.ts`. Browser behaviour
  is covered by e2e only.
- **The e2e suite is `e2e/psq.e2e.ts`**, run by `vitest.e2e.config.ts` via
  `pnpm test:e2e`. It is NOT under repo-root `test/`.

## Changes

1. `apps/web/src/views/Dashboard.tsx` — load the 3D layout.
   - Add a sixth leg to the existing `Promise.all` (`:147-163`) and a sixth
     `useState` slot, honouring the same `cancelled` flag.
   - **The sixth leg must be `api.layout3d(repo.id).catch(() => null)`.** The
     loader is all-or-nothing: any rejection hits the `catch` at `:161` and
     renders "Could not load this repo" (`:179-188`), destroying layout, graph,
     bank, shapes and routes. A 3D-only failure must not blank the dashboard.
     One loader, one loading path — do not add a second state machine, and do
     not let this leg reject.
   - `:141-144` resets `layout`/`selected`/`sections` when `repo.id` changes.
     Reset the new `layout3d` slot to `null` there too, and `dim` to `"2d"`,
     or switching repos briefly shows the previous repo's city.

2. `apps/web/src/views/Dashboard.tsx` — the toggle.
   - `const [dim, setDim] = useState<"2d" | "3d">("2d")`. Note this is a
     `Dashboard`-level `useState` like every other in the file; the card is
     inline JSX, not a component.
   - Two-button segmented control, `2D` / `3D`, using the shadcn button
     primitives already imported in the file. `data-psq="dim-toggle"` on the
     group, `data-psq="dim-2d"` and `data-psq="dim-3d"` on the buttons, and
     `aria-pressed` on the active one.
   - **The card header's right slot at `:203-207` is not empty** — it already
     holds either the selected-entity `Badge` or the "Click an entity to focus
     it" hint. Put the toggle rightmost and keep that content to its left.
     Selection is 2D-only (the city has no picking), so hide the badge/hint
     while `dim === "3d"` rather than showing a stale or meaningless selection.
   - Disable the `3D` button while the 3D layout is `null` — whether still
     loading or failed — rather than mounting the city with no layout. A
     disabled button with a title explaining why beats a broken view.

3. `apps/web/src/views/Dashboard.tsx` — the render swap at `:209-217`.
   - `dim === "2d"` renders the existing `<EntityDiagram …>` untouched;
     otherwise `<EntityCity layout={layout3d} fallback={…} />`.
   - The container height must not change between the two — the city fills
     `h-full w-full`.
   - `fallback` is one short centred line of muted text: WebGL is unavailable
     and the 2D diagram still works. It is not an error state and must not be
     styled as one.
   - `selected` / `onSelect` stay wired to the 2D diagram only.

4. `apps/web/src/components/EntityCity.tsx` — **one comment only.**
   `:40-41` says "Camera controls and picking land in a later phase." After this
   phase there is no such milestone. Reword it to state plainly that the city is
   a static render with no picking or orbit controls, and that this is
   deliberate. No code change in this file.

5. `e2e/psq.e2e.ts` — one test. With a repo open: `[data-psq="dim-toggle"]`
   exists; clicking `dim-3d` mounts **either** `[data-psq="city"]` or
   `[data-psq="city-fallback"]`; clicking `dim-2d` returns to the diagram.
   **Do not assert WebGL succeeded** — headless Chrome may have no GPU and the
   fallback is a legitimate pass. Match the file's existing helpers and style
   rather than inventing a new harness.

6. `README.md` — two edits.
   - The M9 row (`:38`) covers both halves. Split it: M9a done, M9b still
     planned, worded so neither claims the other's work. The city renders after
     this phase but its colours are still hardcoded — say exactly that.
   - The "Next" list at `:44-46` still has "Drift-oracle follow-ups" as item 1,
     pointing at `feature-research/corpus-drift-oracle/progress.md`, which the
     phase after it declared history. Those leftovers are now closed except one
     deliberately-declined item. Remove the stale entry and renumber.

## Constraints

- **No colour work.** `PALETTE` (`scene3d.ts:13-28`) and the comment at `:12`
  stay exactly as they are. If the city looks flat or low-contrast against the
  card, that is M9b's problem and reporting it is useful — fixing it here is
  scope creep that would pre-empt an unresolved design decision.
- Do not touch `apps/web/src/lib/theme.tsx`, `scene3d.ts`, or `webgl.ts`.
- Do not add picking, orbit controls, or animation.

## Verification

- `pnpm typecheck` — the only lint gate; it covers `@psq/web`.
- `pnpm test` and `PSQ_NO_CORPUS=1 pnpm test`. Report before/after counts for
  both. Baseline after the oracle phase is 200 full / 145 no-corpus.
- `pnpm test:e2e`.
- **Verify every claim against the tree before reporting.** Two phases running,
  two implementers have now been bitten by reporting from intent instead of from
  the diff. `git diff` each file and confirm the change is present.
- Say in the audit what the city actually looks like when rendered, including
  whether it reads clearly against the card in light and dark mode. That
  observation is M9b's starting input.

## Files touched

| file | change |
|---|---|
| `apps/web/src/views/Dashboard.tsx` | sixth fetch with its own catch, resets, `dim` state, toggle, render swap |
| `apps/web/src/components/EntityCity.tsx` | one stale comment reworded; no code change |
| `e2e/psq.e2e.ts` | one toggle test |
| `README.md` | split the M9 row; drop the stale "Next" entry |
| `feature-research/m9a-wire-city/audit.md` | **new** — implementer's audit |

Out of scope and deliberately not absorbed: theme-derived colours, 3D picking or
selection, orbit/camera controls, animation, `--graph-hub` in the city, and
light-intensity tuning.
