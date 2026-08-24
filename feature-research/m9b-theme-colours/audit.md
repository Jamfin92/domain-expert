# M9b — theme-derived colours for the entity city — audit

## Files changed

- `apps/web/src/lib/scene3d.ts`
- `apps/web/src/components/EntityCity.tsx`
- `apps/web/src/views/Dashboard.tsx`
- `apps/web/src/styles.css`
- `apps/web/test/scene3d.test.ts`
- `e2e/psq.e2e.ts`
- `README.md`
- `feature-research/m9b-theme-colours/audit.md` (this file, new)

Caveat for the reviewer scoping the diff: the working tree already carried
**uncommitted M9a changes** (in `EntityCity.tsx`, `Dashboard.tsx`,
`e2e/psq.e2e.ts`, `README.md`, plus `feature-research/m9b-theme-colours/plan.md`
and the two untracked `feature-research/m9a-wire-city/` files) before this task
started. `git diff` therefore shows M9a and M9b together in those files. I did
not touch `plan.md` or the `m9a-wire-city/` files.

## What changed, per file

### `apps/web/src/lib/scene3d.ts`
- `PALETTE` replaced by `CityPalette` type and `CITY_PALETTE: Record<"light" |
  "dark", CityPalette>` with exactly the §3 hex values, including the new
  `cone` / `coneInferred` keys.
- New exports `LIGHT_AMBIENT = 0.75`, `LIGHT_DIRECTIONAL = 1.1`,
  `LIGHT_DIRECTION: Vec3 = { x: 1, y: 2, z: 1.5 }` — same numbers as before,
  moved so scene and test cannot disagree. (§5's pseudo-code wrote the
  direction as an array; I used the file's existing `Vec3` `{x,y,z}` shape.)
- New exports `relativeLuminance(hex)` and `contrastRatio(a, b)` (WCAG sRGB).
- The stale ":12" comment rewritten per §6: what `CITY_PALETTE` is, why the
  city ignores `--graph-*`, and that a lit face renders at roughly half its
  token because of the `/π` (`BRDF_Lambert`).

### `apps/web/src/components/EntityCity.tsx`
- `const { resolved } = useTheme()`; `const palette = CITY_PALETTE[resolved]`
  taken **straight from the module-level table** — no inline object, so the
  effect dep is identity-stable per theme.
- Every `PALETTE.*` reference is now `palette.*`; cones use the new
  `palette.cone` / `palette.coneInferred` keys instead of sharing the line
  colours.
- Lights use `LIGHT_AMBIENT` / `LIGHT_DIRECTIONAL` /
  `LIGHT_DIRECTION.x/y/z` — no repeated literals.
- Effect deps are now `[layout, webglOk, palette]` (scene rebuild on theme
  switch, per §4; no material mutation).
- `data-city-palette` (the resolved building colour as `#rrggbb`) added to
  **both** mutually exclusive return roots — the fallback div and the city
  div — as an additional attribute. No wrapper element; the
  `city + fallback === 1` e2e assertion still passes.

### `apps/web/src/views/Dashboard.tsx` (three M9a leftovers, §6)
- The disabled 3D button's `title` moved to a wrapper `span` (the shadcn base
  class sets `disabled:pointer-events-none`, so the title on the button could
  never show), with a comment saying why.
- `api.layout3d(...).catch` now `console.warn`s the error and **still resolves
  to `null`, never rejects**.
- `role="group"` and `aria-label="Diagram dimension"` on the
  `data-psq="dim-toggle"` span.

### `apps/web/src/styles.css` — comments only, zero value changes
- Above light `--card` and dark `--card`: the pinned 0xffffff / 0x121824 in
  `scene3d.test.ts` must be updated if these change.
- On the `--graph-*` block: the 3D city deliberately does not read these; its
  palette lives in `scene3d.ts` as `CITY_PALETTE`.

### `apps/web/test/scene3d.test.ts`
- Old `PALETTE` describe (24-bit-int only) replaced by:
  - `relativeLuminance` / `contrastRatio` anchor tests (`#000`/`#fff` = 21,
    identical = 1);
  - identical key set across themes;
  - the 24-bit-int assertion, kept, now over both themes;
  - the §3 bands, **computed** from `CITY_PALETTE`, the exported light
    constants and the pinned card colours (`{ light: 0xffffff, dark:
    0x121824 }`, comment naming the `styles.css` `--card` blocks):
    - lit surfaces ≥ 2.5 vs card on top / +z / +x (the only faces the camera
      sees);
    - ground order (see the deviation below);
    - unlit lines ≥ 3.0 vs card;
    - `buildingEdge` ≥ 2.0 vs the lit building body on every visible face;
    - cones within 1.5 of their line's colour on the top face.
- The factor formula is `(LIGHT_AMBIENT + LIGHT_DIRECTIONAL * dotNL) /
  Math.PI` with a comment naming `BRDF_Lambert`'s `RECIPROCAL_PI` and saying
  the `/ Math.PI` is the load-bearing term. I re-derived the plan's factors
  independently before writing it (top 0.4988, +z 0.4338, +x 0.3688) and they
  match §0.

### `e2e/psq.e2e.ts` — two new tests after the 2D/3D swap test
- *Palette follows the theme*: opens the fixture, forces Light, switches to
  3D, reads `data-city-palette` (from whichever root rendered), clicks
  `button[aria-label="Dark"]`, reads again; asserts each value matches the
  theme from `html.class` and that the two differ. The expected strings
  `"#8b95a5"` / `"#b6c0d2"` are pinned literally with a comment that they must
  match `CITY_PALETTE`; nothing is imported from `apps/web` (no `@/*` mapping
  in `e2e/tsconfig.json`).
- *City is not blank*: conditional by design — if the fallback rendered, the
  test calls `ctx.skip()` so the skip is visible in the output; if the city
  rendered, it `readPixels` the drawing buffer in `page.evaluate` and asserts
  the pixels are not uniform. See the deviation below for the readback
  mechanics.

### `README.md`
- M9b row → done; M9b dropped from "Next" and the list renumbered (M5, M6, M7).

## Deviations from the plan

1. **§3 ground-order band, light mode.** The plan's sentence says the building
   must be "darker \[than the plate\] in light mode", but the plan's own light
   values — explicitly unchanged from M9a ("light keeps three of five
   surfaces", "light mode... this phase leaves it alone") — have building
   `0x8b95a5` *lighter* than plate `0x6b7280`. The sentence and the value
   table cannot both be satisfied. I did **not** re-tune any colour; I encoded
   the invariant the approved values actually satisfy, which holds in both
   themes: the plate is the darker of the two lit surfaces (building luminance
   > plate luminance), so ground reads as darker ground. A test written to the
   literal sentence goes red against the plan's own table (I hit exactly that
   before changing the assertion). Flagging for the orchestrator: if the
   per-theme direction was intended, the light values need a decision, not a
   test tweak.
2. **Not-blank readback needed one extra mechanism.** A bare
   `readPixels`/`toDataURL` reads all zeros: the renderer has no
   `preserveDrawingBuffer`, so the compositor clears the buffer after each
   frame — verified empirically (the naive version failed with a uniform
   buffer). The test therefore registers its own `ResizeObserver` on the city
   div inside `page.evaluate` and nudges the element height: observers fire in
   creation order, so `EntityCity`'s observer re-renders first and the test's
   observer reads the intact buffer in the same frame, before compositing. It
   resolves on the first non-uniform read and falls back after 1.5s to a final
   read so a genuinely blank canvas still **fails** (not hangs, not skips).
   Still "a readPixels in page.evaluate" per §5; no source file gained
   `preserveDrawingBuffer`.
3. **`LIGHT_DIRECTION` shape**: `{ x, y, z }` (the file's `Vec3` interface)
   rather than the plan's `[1, 2, 1.5]` array sketch. Same numbers.

Everything else is as written. `theme.tsx`, `index.html`, `webgl.ts` untouched;
no token values changed; no new dependency; lighting values and camera
unchanged; `EntityCity`'s props still `{ layout, fallback }`.

## Test results

With `export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"`:

| command | baseline | result |
|---|---|---|
| `pnpm typecheck` | pass | **pass** |
| `pnpm test` | 200 passing | **207 passing, 0 failed** |
| `PSQ_NO_CORPUS=1 pnpm test` | 145 passing / 55 skipped | **152 passing / 55 skipped** |
| `pnpm test:e2e` | 17 | **19 passing** (WebGL available on this machine, so the conditional test ran rather than skipped) |

Net +7 unit tests (1 old `PALETTE` test removed, 8 added), +2 e2e tests.

### Failability checks (both performed, both red, both restored)
- Unit: `dark.plate` broken to `0x1a2030` → `keeps lit surfaces at contrast
  >= 2.5...` **failed**; restored (diff greps clean of the broken value) →
  23/23 green.
- E2e: `dark.building` broken to `0xb7c1d3`, web rebuilt → the
  palette-follows-theme test **failed** on the pinned `"#b6c0d2"`; restored,
  rebuilt → 19/19 green.

### Pixel measurement against the §3 table (tolerance 15%)
Real renders via the e2e harness (scratch script outside the repo), raw
framebuffer read per theme, opaque-pixel colour histogram matched to the
model's predicted rendered colours. mini-efcore covered building (all three
visible faces), plate (all three), buildingEdge, edge, cone; mini-node (whose
edges are all inferred) covered edgeInferred and coneInferred.

Every measured surface matched the §3 contrast prediction within **0.6%** —
most within 0.3%, and the unlit lines to the exact RGB byte (rgb distance 0.0).
Worst entries: plate.+z light 8.62 vs 8.57 predicted (0.6%), building.+z dark
4.66 vs 4.69 (0.6%). No entry anywhere near the 15% stop threshold; the §0/§5
lighting model is confirmed against the real renderer. Screenshots of both
themes were also inspected visually: the dark plate and outlines now read
clearly; light mode is unchanged in character.

## Open risks / notes for the next phase

- **Noted, not fixed (per §6)**: the 2D/3D disagreement over `selected` — the
  aside still shows a stale selection detail while in 3D. Picking is out of
  this phase.
- §1's accepted one-frame lag (new palette one frame before the card
  background changes on a manual theme switch) was not visible in testing;
  screenshots and the e2e theme flow show no artefact. Left as accepted.
- The not-blank e2e test's ResizeObserver-ordering readback relies on
  observers being notified in creation order (per spec and Chromium
  behaviour). If it ever proves flaky on another machine, the fallback path
  makes it fail loudly rather than pass silently.
- The e2e count on a machine **without** WebGL will report 18 passed / 1
  skipped — the skip is by design and visible.
- `git diff` in this working tree mixes uncommitted M9a work with this
  phase's; every claim above was checked against the actual diff hunks, and
  the M9a-only hunks (loading-state plumbing in `Dashboard.tsx`, the 2D/3D
  swap e2e test, the README M9a row) predate this task.

## Post-review fixes (non-blocking items, coordinator-directed)

Review verdict was Ship; two non-blocking fixes were requested and applied.
No palette value changed; no scope beyond the two items.

1. **Ground-order test now asserts rendered order, not token order**
   (`apps/web/test/scene3d.test.ts`). The assertion compares the dimmest
   visible building face's rendered luminance (`min` over the top/+z/+x
   factors) against the plate's top-face rendered luminance — the brightest
   way the plate is ever seen — using the same computed factors as the other
   band tests. A minimum separation of **1.15** is required so a 1-bit gap
   cannot pass. The approved values clear it at **1.3133 (light)** and
   **1.3786 (dark)**; a rendered-order inversion (ratio ≤ 1) or a collapse of
   the gap trips it. Failability proven: `light.plate` perturbed to
   `0x8b95a5` (equal to the building token, rendered ratio ≈ 0.74) → test
   red; restored → 23/23 green. `git diff` confirms the plate values are back
   to `0x6b7280` / `0x8791a3`.
2. **Dead `as const` dropped** from `CITY_PALETTE` in
   `apps/web/src/lib/scene3d.ts`; the explicit `Record<"light" | "dark",
   CityPalette>` annotation remains and was already the operative type.

Gates re-run after both fixes (fnm PATH exported first): `pnpm typecheck`
pass; `pnpm test` **207 passed** (count unchanged — the assertion replaced
the previous ground-order test one-for-one); `PSQ_NO_CORPUS=1 pnpm test`
**152 passed / 55 skipped**; `pnpm test:e2e` **19 passed**.
