# M9b — progress

Status: **shipped and reviewed (verdict: ship, twice).** Uncommitted at the time
of writing; HEAD is still 3fc3f8d, so the tree carries M9a and M9b together.

## What shipped

The entity city now takes its colours from the resolved theme. M9 is done.

- `apps/web/src/lib/scene3d.ts` — the hardcoded `PALETTE` is replaced by
  `CITY_PALETTE: Record<"light" | "dark", CityPalette>`, a module-level table
  with nine keys per theme (`building`, `buildingEdge`, `plate`, `edge`,
  `edgeInferred`, `cone`, `coneInferred`, `ambient`, `directional`). The light
  constants the scene feeds to three are now exported as `LIGHT_AMBIENT`,
  `LIGHT_DIRECTIONAL`, `LIGHT_DIRECTION` so the contrast test and the scene
  cannot disagree. No CSS token, no oklch conversion, no `getComputedStyle`.
- `apps/web/src/components/EntityCity.tsx` — `const palette = CITY_PALETTE[resolved]`
  via `useTheme()`, added to the existing effect deps. The scene rebuilds on a
  theme change rather than mutating materials. `data-city-palette` added as a
  second attribute on **both** mutually exclusive return roots.
- `apps/web/src/views/Dashboard.tsx` — the three M9a leftovers: `title` moved to
  a wrapper span, a `console.warn` in the 3D catch, `role`/`aria-label` on the
  toggle group.
- `apps/web/test/scene3d.test.ts` — key-set, integer and contrast-band tests
  computed from the palette and the exported light constants.
- `e2e/psq.e2e.ts` — two tests: the palette actually changes with the theme, and
  the canvas is not blank.
- `apps/web/src/styles.css` — comments only. No token value changed.
- `README.md` — M9b row marked done, "Next" renumbered.

## Verification (all four gates reproduced independently by the reviewer)

`pnpm typecheck` pass · `pnpm test` **207 passed** · `PSQ_NO_CORPUS=1 pnpm test`
**152 passed / 55 skipped** · `pnpm test:e2e` **19 passed**.

On a machine without WebGL the e2e run reports 18 passed / 1 skipped. The skip
is by design and visible.

**Correction to M9a's progress note:** it said to use `corepack pnpm`. That is
misleading — corepack's shebang also needs node on PATH. Export fnm's bin dir
first and bare `pnpm` (11.21.0) works:

```
export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"
```

## The lesson worth carrying forward

**three's `BRDF_Lambert` divides by π.** The real linear multiplier on a lit
face is `(ambient + directional · dotNL) / Math.PI`, not `ambient + directional ·
dotNL`. r185 has no `useLegacyLights` and `WebGLLights.js` applies no
compensation.

The first M9b plan was written without that term and was wrong throughout: it
claimed a light-mode washout that does not exist, proposed a lighting rebalance
that would have made dark mode worse, and inverted the cone/line relationship.
It was caught by rendering in headless Chromium against the repo's own three
build, not by reading the code. Measured against the shipped scene the model is
now exact to the byte — light plate top face `77,82,92`; the π-less prediction
for that same surface would have been `170,183,202`.

Two consequences for anyone touching this again:

- **On a lit surface the token is not the colour.** Contrast must be evaluated
  per visible face. The camera (azimuth π/4, elevation π/5.5) sees only top,
  `+z` and `+x`; face factors are **0.4988 / 0.4338 / 0.3688**.
- The M9a implementer's screenshot reading — that the dark plate nearly
  vanishes — was correct, and both reviewers who doubted it were wrong. It was
  a colour problem, not a lighting one. **The lighting was not changed**
  (ambient 0.75, directional 1.1, direction `(1,2,1.5)`); light mode was already
  fine and a rebalance only perturbs the working half.

## Defects fixed

Measured across the three visible faces, contrast against `--card`:

| surface | before | after |
| --- | --- | --- |
| dark `plate` | 1.88–2.27 | 2.60–3.22 |
| dark `buildingEdge` | 1.82 | 10.98 |
| light `buildingEdge` vs the lit body it overlays | 1.49–1.85 | 2.11–2.61 |

Plus the cone/line mismatch: cones are lit and their lines are not, so a shared
colour rendered the cone at 0.499× its line. Cones now have their own two keys
per theme, each set to its line's colour ÷ the top-face factor.

## Decisions made

- **Palette identity matters.** `EntityCity` takes the object straight from
  `CITY_PALETTE[resolved]`. An inline object literal would churn the effect deps
  and rebuild the WebGL scene on every render.
- **The plan's §3 ground-order sentence was defective, not the values.** It said
  the building must be "lighter than the plate in dark mode, darker in light
  mode", but the approved (and explicitly unchanged) light values make the
  building lighter — and the reviewer confirmed it is unsatisfiable under either
  reading, token or rendered. The implementer flagged it instead of re-tuning a
  colour to fit, which was the right call. The invariant actually encoded is
  **the plate is the darker lit surface in both themes**, asserted on *rendered*
  luminance: `min(building × its visible face factors) > plate × top-face
  factor`, with a minimum separation of **1.15**. Approved values clear it at
  1.3133 light / 1.3786 dark.
- **A green contrast test proves nothing on its own.** Failability was
  demonstrated four times across the two rounds — breaking `dark.plate`,
  breaking `dark.building`, deleting the `/ Math.PI` (three assertions went
  red), and a *near-miss* plate value at ratio 1.0961 that a plain inversion
  check would have passed. Keep that habit if these bands are ever touched.
- **One frame of new-city-on-old-card** is possible on a manual theme switch,
  because `theme.tsx` toggles the class in a passive effect while `resolved` is
  derived during render. Accepted, not visible in testing, not worth editing
  `theme.tsx`.
- Under `StrictMode` each theme switch constructs and tears down a real
  `WebGLRenderer` twice in dev. Expected; teardown is sound.

## Known limitations

- The not-blank e2e test registers its own `ResizeObserver` after the
  component's and reads the framebuffer in the same frame (`preserveDrawingBuffer`
  is off, so a bare `readPixels` would read a cleared buffer). Verified sound by
  mechanism and by stubbing `renderer.render` — a genuinely blank canvas fails.
  Residual risk is one-sided: a slow machine blows the 1500 ms budget and it goes
  red, never falsely green. Uniformity is measured against pixel (0,0), so it
  proves "something drew", not "the city drew".
- The visible-face set (top/`+z`/`+x`) is hardcoded in the test. A camera change
  would silently invalidate every band while leaving the suite green. The block
  comment also spells out the face factors and margins as prose, which can drift
  from the exported constants.
- Token order is no longer asserted anywhere — rendered order replaced it rather
  than joining it. Strictly stronger, but the weaker check is gone.
- The 3D toggle's `title` now shows on hover but is still unreachable by keyboard
  or screen reader. The plan asked for exactly this; it is a half-fix if
  discoverability is the goal.

## What the next phase needs to know

**The one M9 item still open is picking.** `selected` is treated two ways in 3D:
the header badge and hint are hidden, but the right-hand aside still shows the
stale 2D selection detail. Deferred from M9a (item 4) and again from M9b — it
needs real picking (raycast against the building meshes) plus a decision about
whether selection is shared between 2D and 3D or separate per dimension. There
is no orbit control either. **Neither is a README milestone**, so scope it
deliberately before starting rather than letting it ride along inside another
phase.

Otherwise the README order stands: **M5** (React clients, table↔route↔component
links — the route reader is already built and waiting for its client side), then
M6, then M7.

Nothing in this phase has been committed.
