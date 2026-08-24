# M9b — theme-derived colours for the entity city

M9a shipped: the city renders behind a 2D/3D toggle with the hardcoded grey
`PALETTE`. This phase gives it a per-theme palette.

This plan **replaces** two earlier drafts of itself, both recoverable from git
history. Do not work from either. What each got wrong is recorded below, because
in both cases the error is the interesting part.

## 0. What the shipped city actually looks like, measured

three's Lambert BRDF divides by π (`BRDF_Lambert`'s `RECIPROCAL_PI`,
`three/src/renderers/shaders/ShaderChunk/common.glsl.js`), and r185 has no
`useLegacyLights`. So the linear multiplier on a lit face is

```
(ambient + directional · dotNL) / π
```

The **second draft of this plan omitted the `/π`** and was therefore wrong by
3.14× on every lit surface — it "corrected" the M9a implementer and got the
diagnosis backwards. With the real model, at today's `ambient 0.75` /
`directional 1.1` the per-face factors are **top 0.499, +z 0.434, +x 0.369**.
The camera (`AZIMUTH = π/4`, `ELEVATION = π/5.5`, `scene3d.ts:188-190`) only ever
sees those three faces; the `away` face at 0.239 is never on screen and is
excluded throughout.

Contrast of today's rendered surfaces against their own card
(`--card` = `#ffffff` light `styles.css:14`, `#121824` dark `styles.css:46`),
across visible faces:

| surface | lit? | light card | dark card |
|---|---|---|---|
| building `0x8b95a5` | yes | 5.29–6.55 | 2.71–3.36 |
| plate `0x6b7280` | yes | 7.84–9.44 | **1.88–2.27** |
| buildingEdge `0x3d4452` | no | 9.78 | **1.82** |
| edge `0x64748b` | no | 4.76 | 3.73 |
| edgeInferred `0x94a3b8` | no | 2.56 | 6.93 |

**The M9a implementer was right and both reviewers were wrong.** The district
plate really does nearly vanish in dark mode — 1.88–2.27, and 2.27 is its
*brightest* visible face. The M9a reviewer's counter-argument (that a mid-grey
sits equidistant from both cards) ignored the lighting; the second draft of this
plan repeated the mistake with more arithmetic behind it. The lesson worth
keeping: on a lit surface the token is not the colour.

Alongside it, `buildingEdge` at **1.82** is invisible in dark mode — the
wireframe overlay whose stated job (`scene3d.ts:16`) is "so building form reads
under flat lighting". Dark mode is flat *and* groundless.

Light mode has no washout. It is if anything heavy — a plate at 7.84–9.44
against white is a very dark slab. It reads well, and this phase leaves it
alone.

One more defect the table hides: `buildingEdge` against the **lit building body
it overlays** is only 1.49–1.85 in light mode. The outline is weak in both
themes, for different reasons.

## 1. Decision: the palette is a pure function of `resolved`, not a DOM read

The first draft built this phase around `getComputedStyle` plus an `oklch()`→int
converter. **Do not.** Ship a module-level table keyed by theme:

```ts
export type CityPalette = Record<
  | "building" | "buildingEdge" | "plate"
  | "edge" | "edgeInferred" | "cone" | "coneInferred"
  | "ambient" | "directional",
  number
>;
export const CITY_PALETTE: Record<"light" | "dark", CityPalette> = { light: {…}, dark: {…} };
```

`EntityCity` reads `const { resolved } = useTheme()` and indexes it.

Why, and what it costs:

- **The `--graph-*` tokens are unusable anyway.** They describe a 2D SVG where a
  node is a *stroked* shape on a distinct background. `--graph-node` is
  `oklch(1 0 0)` — pure white — and the city composites against `--card`, also
  white in light mode (the renderer clears transparent, `EntityCity.tsx:103`;
  the nearest background-carrying ancestor is `Card`'s `bg-card`). The city
  needs its own values under any design. Once that is granted, CSS buys only
  "a designer can edit it in styles.css".
- **That convenience costs a colour pipeline psq does not otherwise have.**
  Nothing in the repo parses a colour today — `getComputedStyle` appears in zero
  source files and three cannot parse `oklch()`. It would mean a new `color.ts`,
  an oklch string grammar (percentage vs number lightness, `none`, `/ alpha` —
  all left unspecified by the first draft), a fallback palette for unparseable
  tokens, and the `.trim()` trap.
- **It deletes the first draft's §1 entirely.** That section described a real
  React ordering bug and prescribed changing `theme.tsx:57` to a
  `useLayoutEffect`. The bug exists only when the palette is read from the
  **DOM** after the `.dark` class is toggled. `resolved` is derived **during
  render** (`theme.tsx:54-55`) — not state, not read back off the class — so a
  context consumer is correct on the same render that changes it. **Do not touch
  `apps/web/src/lib/theme.tsx`.** Verified by review; there is nothing to fix
  once the DOM read is gone.
- All three paths that change `resolved` — `setTheme`, the `matchMedia` listener
  (`theme.tsx:47-52`), and mount — are React state changes, so the city follows
  the theme for free.

**Accepted, not overlooked:** the `.dark` class toggle stays a passive effect, so
on a theme switch the city repaints with the new palette one frame before the
card background changes. One frame of new-city-on-old-card, on a manual action.
Fixing it means editing `theme.tsx` for a single frame; not worth it. If it
proves visible on screen, say so in the audit and it becomes its own decision.

## 2. Decision: the lighting is not changed

`ambient 0.75` / `directional 1.1` stay exactly as they are, and so does the
direction `(1, 2, 1.5)`.

The second draft proposed rebalancing to `0.55 / 0.60` to buy a "token ≈ rendered
colour" property. Under the correct model that rebalance **darkens nothing and
lightens everything by 2×**, pushing the dark plate from 1.88–2.27 down to about
1.5 and wrecking light mode's contrast at the same time. The property it was
buying is worth nothing anyway: the test can apply the exact factor formula
itself (§5).

Nothing clips — the maximum factor is 0.499, so even `0xffffff` renders at
`#bbbbbb`. Headroom is not a problem and never was; the first draft's
white-on-white fear came from the same missing `/π`.

Per-theme intensities are also out. One set of lights, two sets of colours.

## 3. The values

Light keeps three of five surfaces. `buildingEdge` is darkened to fix the
overlay ratio; `edgeInferred` is darkened because 2.56 is too faint for a 1px
line. Dark is new throughout. Cones gain their own keys — see below.

| key | light | dark | lit? | rendered contrast vs card, visible faces |
|---|---|---|---|---|
| `building` | `0x8b95a5` *(unchanged)* | `0xb6c0d2` | yes | light 5.29–6.55 · dark 4.11–5.26 |
| `plate` | `0x6b7280` *(unchanged)* | `0x8791a3` | yes | light 7.84–9.44 · dark 2.60–3.22 |
| `buildingEdge` | `0x282d38` | `0xc3ccdb` | no | light 13.79 · dark 10.98 |
| `edge` | `0x64748b` *(unchanged)* | `0x8f9aad` | no | light 4.76 · dark 6.26 |
| `edgeInferred` | `0x7d8899` | `0x6b7488` | no | light 3.59 · dark 3.79 |
| `cone` | `0x8aa0be` | `0xc4d2ec` | yes | renders as `edge` — see below |
| `coneInferred` | `0xacbad1` | `0x94a0ba` | yes | renders as `edgeInferred` |
| `ambient` | `0xffffff` | `0xffffff` | — | — |
| `directional` | `0xffffff` | `0xffffff` | — | — |

`buildingEdge` against the **lit building body** — the ratio that makes form
read, and the one that is 1.49–1.85 today in light mode:
light **2.11–2.61**, dark **2.09–2.67**.

**Cones need their own keys.** Today they share `edge` / `edgeInferred` with
their lines (`EntityCity.tsx:167-168`), but a cone is lit and its line is not, so
the cone renders at 0.499× the line in linear — a visible 1.76–1.82 mismatch
between an arrowhead and the arrow it terminates. The four cone values above are
each their line's colour divided by the top-face factor, so a cone's top face
renders as *exactly* its line colour and its side faces sit within 1.13–1.29 of
it. None of the four clips.

**The bands are the requirement, not the hex.** If a value looks wrong on
screen, move it and keep the band:

- lit surfaces (`building`, `plate`): **≥ 2.5** against the card on every
  *visible* face, and the building must be lighter than the plate it stands on
  in dark mode, darker in light mode, so ground always reads as ground.
- unlit lines (`buildingEdge`, `edge`, `edgeInferred`): **≥ 3.0** against the
  card, and `buildingEdge` **≥ 2.0 against the lit building body** on every
  visible face.
- cones: within **1.5** of their line's colour on the top face.

## 4. Decision: rebuild the scene, do not mutate materials

The first draft preferred `material.color.setHex(…)`. That option does not
exist as written: every material is created inside the `useLayoutEffect` at
`EntityCity.tsx:89` and tracked only in a local `disposables` Set — **nothing is
stored on a ref**, so no handle survives the effect. Mutation would mean a new
ref holding 9 materials and 2 lights plus a second effect kept in sync with the
builder by hand, for an interaction that fires on a manual theme switch.

Add `palette` to the existing deps (`EntityCity.tsx:214`, today `[layout,
webglOk]`) and let the scene rebuild. The teardown at `:206-213` was reviewed in
an earlier phase and disposes renderer, context and geometries correctly.

**The identity trap:** a palette object built per render changes the deps every
render and rebuilds forever. Taking it straight from module-level
`CITY_PALETTE[resolved]` makes identity stable by construction — no `useMemo`,
and none needed. Do not build the object inline.

Under `StrictMode` (`main.tsx`) each theme switch constructs and tears down a
real `WebGLRenderer` twice in dev. The teardown is sound, so this is expected,
not a leak.

## 5. Tests

Both must be able to fail. Add them, break a colour on purpose, confirm red.

**1. `apps/web/test/scene3d.test.ts`** — extend the `PALETTE` block
(`:207-215`, which asserts only 24-bit ints, and is why a white-on-white palette
would ship green today):

- both themes expose an identical key set;
- every value is a valid 24-bit int (keep today's assertion);
- **the §3 bands hold**, computed — not hardcoded — from the palette, the
  lighting constants and the card colour.

The factor formula the test must use, which is the whole point of the test:

```
factor(dotNL) = (ambient + directional * dotNL) / Math.PI   // three's BRDF_Lambert: RECIPROCAL_PI
dotNL for each visible face = normalise(LIGHT_DIRECTION) · faceNormal
faces: top (0,1,0), +z (0,0,1), +x (1,0,0)      // the camera never sees the others
```

Write the `/ Math.PI` into the code with a comment naming `BRDF_Lambert`, or the
test passes for any palette forever and this phase's own bug ships again.

To support it, export from `scene3d.ts`: `relativeLuminance(hex: number)` and
`contrastRatio(a: number, b: number)` (WCAG sRGB), plus `LIGHT_AMBIENT = 0.75`,
`LIGHT_DIRECTIONAL = 1.1`, and `LIGHT_DIRECTION: Vec3 = [1, 2, 1.5]`.
**`EntityCity.tsx:117-119` must then use those constants** rather than repeating
the literals — the light direction lives in `EntityCity` today, and the test and
the scene must not be able to disagree about it. Unit-test the two helpers
against known pairs (`#000`/`#fff` = 21, identical = 1) before relying on them.

Pin the card colours in the test as `{ light: 0xffffff, dark: 0x121824 }` with a
comment naming `styles.css:14` and `:46` as their source; the test cannot read
oklch.

**2. `e2e/psq.e2e.ts`** — two tests.

- *Palette follows the theme.* Add a `data-city-palette` attribute carrying the
  resolved building colour as a hex string. **Put it on both of `EntityCity`'s
  return roots** — the fallback div (`:217`) and the city div (`:219`) — as a
  second attribute alongside the existing `data-psq`. Do **not** add a wrapper
  element: the existing `expect(city + fallback).toBe(1)` at `psq.e2e.ts:132-133`
  depends on that structure, and a distinct attribute name keeps the counts
  intact. The palette is resolved whether or not WebGL initialised, so the
  attribute is meaningful on both paths. Open a repo, switch to 3D, read the
  attribute, click `button[aria-label="Dark"]`, read it again; assert it changed
  and that each value matches the theme reported by `html.class`.
  **Pin the two expected hex strings literally in the e2e file**, with a comment
  that they must match `CITY_PALETTE`. Do not import from `apps/web` —
  `e2e/tsconfig.json` has no `@/*` path mapping and `scene3d.ts:1` imports
  `@/lib/api`, so the import would fail `pnpm typecheck` with TS2307.
- *The city is not blank.* This closes M9a review item 5, handed to this phase
  and dropped by both drafts. **Conditional by design:** if `[data-psq="city"]`
  rendered, read the canvas back (`toDataURL` or a `readPixels` in
  `page.evaluate`) and assert the pixels are not uniform. If the fallback
  rendered instead, skip — a machine without WebGL is a legitimate pass, exactly
  as in M9a. This is a gate on machines that can run it, not a silent no-op:
  the skip must be visible in the test output.

Match the existing idiom — `page.getAttribute("html", "class")`,
`waitForTimeout(200)`, `analyzeFixture` — as used by the two theme tests already
at `psq.e2e.ts:143-179`.

## 6. M9a leftovers to close here

All small; all in files this phase already opens.

- `scene3d.ts:12` — "phase 2b swaps these for theme-derived values" is stale and
  is this phase. Rewrite it to say what `CITY_PALETTE` is, why the city does not
  read the `--graph-*` tokens, and that a lit surface renders at roughly half its
  token because of the `/π`.
- `styles.css` — comments only, **no token value changes**: near the `--graph-*`
  block (`:36-40`), that the 3D city deliberately does not read these and where
  its palette lives; near `--card` (`:14`, `:46`), that changing it means
  updating the pinned card colours in `apps/web/test/scene3d.test.ts`.
- `Dashboard.tsx:242` — the disabled 3D button's `title` can never show, because
  the shadcn base class sets `disabled:pointer-events-none`
  (`components/ui/button.tsx:8`). Move the `title` to a wrapper `span`.
- `Dashboard.tsx:162` — add a `console.warn` inside the
  `api.layout3d(…).catch(…)` so a permanently failing endpoint is diagnosable.
  **It must still resolve to `null` and never reject** — that property is why a
  3D failure does not blank the dashboard.
- `Dashboard.tsx:224` — `role="group"` and an `aria-label` on the bare `<span>`
  carrying `data-psq="dim-toggle"`.

Deliberately **not** taken: the 2D/3D disagreement over `selected` — the aside
still shows a stale selection detail in 3D. That is a picking question and
picking is not in this phase. Note it in the audit; do not fix it.

## 7. Constraints

- Do not add picking, orbit controls, or animation.
- Do not add `getComputedStyle`, a CSS colour parser, or an oklch converter.
- Do not change the light intensities, the light direction, or the camera.
- Do not touch `apps/web/src/lib/theme.tsx`, `index.html`, or `webgl.ts`.
- Do not change any token **value** in `styles.css`; comments only.
- Do not invent a hub distinction — `--graph-hub` exists, the city draws none.
- `EntityCity`'s props stay `{ layout, fallback }`. The theme is read inside the
  component; `Dashboard` does not pass a palette.
- No new dependency.

## 8. Verification

- Put fnm's bin on PATH first —
  `export PATH="$HOME/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH"`.
  Then bare `pnpm` (11.21.0) works. M9a's progress note says "use `corepack
  pnpm`"; that is wrong and inherited — without node on PATH, corepack's shebang
  fails too.
- `pnpm typecheck`.
- `pnpm test` and `PSQ_NO_CORPUS=1 pnpm test`. Baseline **200 full / 145
  no-corpus** (55 skipped). Report before and after.
- `pnpm test:e2e`. Baseline **17**.
- Break one palette entry to an out-of-band value; confirm the contrast test goes
  red; restore it. Report that you did this. A contrast test that cannot fail is
  the bug this phase exists to fix.
- **Screenshot both themes and measure real pixels** — a building top face, the
  plate, a building outline, an FK edge line and a cone — and compare against the
  §3 table. The table is computed; this is the step that checks the computation
  against a real renderer. **If any entry is off by more than 15%, stop and
  report it rather than adjusting the tokens to match.** A mismatch means the
  lighting model in §0/§5 is still wrong, and re-tuning colours on top of a wrong
  model is how this plan got its last two revisions.
- Verify every claim against `git diff` before writing the audit. Implementers on
  this project have twice reported from intent rather than from the diff.

## Files touched

| file | change |
|---|---|
| `apps/web/src/lib/scene3d.ts` | `PALETTE` → `CITY_PALETTE` keyed by theme; `CityPalette` type; `LIGHT_AMBIENT` / `LIGHT_DIRECTIONAL` / `LIGHT_DIRECTION`; `relativeLuminance` / `contrastRatio`; the `:12` comment |
| `apps/web/src/components/EntityCity.tsx` | `useTheme()`, palette indexing, `palette` in deps, cone materials use the new keys, lights use the exported constants, `data-city-palette` on both return roots |
| `apps/web/src/views/Dashboard.tsx` | three M9a leftovers: title wrapper, `console.warn`, `role`/`aria-label` |
| `apps/web/src/styles.css` | comments only — no value changes |
| `apps/web/test/scene3d.test.ts` | key-set, int and contrast-band tests; helper tests |
| `e2e/psq.e2e.ts` | palette-follows-theme test; conditional not-blank test |
| `README.md` | M9b row → done; drop M9b from the "Next" list and renumber |
| `feature-research/m9b-theme-colours/audit.md` | **new** |

Out of scope: picking and selection in 3D, orbit/camera controls, animation,
`--graph-hub` in the city, per-theme or rebalanced lighting, CSS-sourced
colours, and any change to the 2D diagram's palette.
