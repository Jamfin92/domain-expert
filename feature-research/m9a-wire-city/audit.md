# M9a — wire the entity city into the web UI — implementer's audit

## Files changed

- `apps/web/src/views/Dashboard.tsx`
- `apps/web/src/components/EntityCity.tsx`
- `e2e/psq.e2e.ts`
- `README.md`
- `feature-research/m9a-wire-city/audit.md` (this file, new)

## What changed per file

### `apps/web/src/views/Dashboard.tsx`

- Imports: added `type Layout3D` to the `@/lib/api` import and added
  `EntityCity`.
- Two new `Dashboard`-level state slots: `layout3d` (`Layout3D | null`) and
  `dim` (`"2d" | "3d"`, initial `"2d"`).
- The repo-change reset block now also does `setLayout3d(null)` and
  `setDim("2d")`, so switching repos never shows the previous repo's city.
- Sixth leg on the existing `Promise.all`:
  `api.layout3d(repo.id).catch(() => null)`. The leg cannot reject, so a
  3D-only failure never trips the all-or-nothing error path; it just leaves
  `layout3d` at `null` and the 3D button disabled. Same `cancelled` flag,
  same single loader — no second state machine.
- Card header right slot: the selected-entity `Badge` / "Click an entity to
  focus it" hint is now shown only while `dim === "2d"` (selection is 2D-only;
  the city has no picking), with the new segmented control rightmost of it.
  The control is `data-psq="dim-toggle"` with two `Button`s
  (`data-psq="dim-2d"` / `data-psq="dim-3d"`), `aria-pressed` reflecting the
  active one, `secondary`/`ghost` variants like the section pickers in the
  same file. The 3D button is `disabled` while `layout3d === null` (loading or
  failed) with a `title` saying the 3D layout is not available.
- Render swap inside the same `CardContent` (`h-[32rem] xl:h-[40rem]`,
  unchanged): `dim === "3d" && layout3d` renders
  `<EntityCity layout={layout3d} fallback={…} />`; otherwise the existing
  `<EntityDiagram>` / "Laying out the graph…" branch, untouched.
  `selected`/`onSelect` stay wired to the 2D diagram only. The fallback is one
  muted centred line ("3D needs WebGL … The 2D diagram still works"), not
  styled as an error.

### `apps/web/src/components/EntityCity.tsx`

One comment reworded (`:39-41`): "Camera controls and picking land in a later
phase" now reads "There is deliberately no picking and no orbit or camera
control". No code change.

### `e2e/psq.e2e.ts`

One new test, "switches the graph between 2D and 3D and back", placed with the
other dashboard tests in the first describe block and using the file's
existing `analyzeFixture`/locator style. It asserts the toggle exists,
clicking `dim-3d` mounts exactly one of `[data-psq="city"]` /
`[data-psq="city-fallback"]` and unmounts the diagram, and clicking `dim-2d`
brings the diagram back. It deliberately does not assert WebGL succeeded.

### `README.md`

- Milestone table: the single M9 row split into "M9a — wire the 3D city into
  the web UI (2D/3D toggle, hardcoded palette) | done" and "M9b —
  theme-derived colours for the city | planned".
- "Next" list: removed the stale "Drift-oracle follow-ups" item, put M9b
  first (worded as the open colour question), renumbered M5/M6/M7.

## Deviations from the plan

Two small ones, both in the fallback styling:

- The plan says the fallback line is "centred". `EntityCity`'s fallback
  wrapper (`<div data-psq="city-fallback">`, `:217`) has no height styling and
  the plan forbids code changes in that file, so `h-full` vertical centring is
  impossible from the outside. The fallback uses `py-24 text-center` instead:
  horizontally centred, vertically padded rather than truly centred in the
  32/40rem card.
- Everything else is as planned.

## Test results

All run on this tree (Node v24.19.0 via fnm/corepack — `pnpm` is not on PATH
in this environment, so every command below was `corepack pnpm …`):

- `pnpm typecheck` — pass (root, e2e, `@psq/web`, `@psq/desktop`).
- `pnpm test` — 200 passed / 0 failed (baseline 200). No change.
- `PSQ_NO_CORPUS=1 pnpm test` — 145 passed, 55 skipped (baseline 145). No
  change.
- `pnpm test:e2e` — 17 passed (was 16; the new toggle test is the 17th and
  passes). Headless Chromium here does provide WebGL (SwiftShader), so the
  real city mounted (`city: 1, fallback: 0`), and the fallback branch is
  covered by the test's either/or assertion rather than observed.

Every file's change was verified present via `git diff` before writing this.

## What the city actually looks like (M9b's starting input)

Screenshotted through the e2e harness against the mini-efcore fixture, light
and dark, 1440×900:

- **Light mode**: reads clearly. The buildings are mid-slate grey boxes with
  visible edge lines, the district plate is a darker grey slab, and the whole
  scene has good contrast against the white card. It looks a bit monochrome
  and "unthemed" — clearly not the app's palette — but nothing is illegible.
- **Dark mode**: the buildings still read fine (mid-grey against near-black),
  but the district ground plate nearly vanishes — it is a dark grey on a
  near-black card, so the city looks like buildings floating with a faint
  shadow under them. The FK edge lines above the rooftops are thin and faint
  in both themes, and the direction cones are small dark wedges that are easy
  to miss.
- The scene is identical in both themes (hardcoded `PALETTE`), which is
  exactly the M9b problem: light mode is acceptable today, dark mode's ground
  plane and edges are the weak points. Note the M9b plan worried about
  white-on-white in *light* mode with the obvious theme tokens; the hardcoded
  greys have the inverse problem, dark-on-dark in dark mode.

## Open risks

- The 3D button's disabled state has a `title` but no visible explanation;
  keyboard/screen-reader users get `disabled` + `title` only. Acceptable for
  a temporary loading state, worth a thought if 3D failures turn out common.
- The e2e toggle test passes through the WebGL branch on machines with a GPU
  or SwiftShader and the fallback branch on bare CI; both are asserted as one
  either/or, so a regression that breaks only the branch not taken on a given
  machine would not be caught there.
- `apps/web/dist` was rebuilt by `pnpm test:e2e` (its script runs
  `build:web` first); the dist directory is untracked, so nothing stale
  lingers, but anyone reading e2e results should know the bundle on disk now
  includes this change.
