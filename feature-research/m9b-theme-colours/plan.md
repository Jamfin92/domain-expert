# M9b — theme-derived colours for the entity city

**Not ready to implement.** This file exists so the review findings that split
M9 are not lost. It needs an explore step and a real design decision first —
specifically the contrast problem in §2, which has no obvious answer.

Prerequisite: M9a (`../m9a-wire-city/plan.md`) must be shipped, so the city is
on screen and the contrast question can be answered by looking at it.

## The goal

`PALETTE` (`apps/web/src/lib/scene3d.ts:13-28`) is seven hardcoded ints, and
`:12` marks them as this milestone's job. Theme tokens live in
`apps/web/src/styles.css` (`:root` at `:9`, `.dark` at `:43`) and are `oklch(…)`.
three.js needs a number, so a real colour-space conversion is required.
`getComputedStyle` appears in **zero** source files today — the 2D diagram
sidesteps this entirely by passing `"var(--graph-edge)"` straight into SVG
attributes, which three cannot do.

## 1. The React ordering bug — settled, and it costs an extra file

A first draft got this backwards, so it is written down properly.

`ThemeProvider` toggles the `.dark` class in a **passive** `useEffect`
(`apps/web/src/lib/theme.tsx:57-59`) and wraps `App` (`main.tsx:12-14`), so any
palette consumer is its **descendant**. React runs all layout effects before any
passive effect, and **both phases run child→parent**. So:

- consumer `useLayoutEffect` + provider `useEffect` → consumer first → **old**
  tokens.
- consumer `useEffect` + provider `useEffect` → also child-first → **old**
  tokens.

With deps `[resolved]` nothing re-fires, so the palette is stale forever after
the first switch. It looks correct on mount only because the inline script in
`index.html` sets the class before first paint — which is why this ships broken
past a casual manual test.

**Fix:** make the class toggle at `theme.tsx:57` a `useLayoutEffect` **and** put
the palette read on a passive `useEffect`. Provider layout effects run at the
end of the layout phase (child→parent, provider is the parent), and all passive
effects run after that, so the read is guaranteed to see the new class.
`apps/web/src/lib/theme.tsx` is therefore in this phase's files-touched list —
the alternative, toggling the class synchronously inside `setTheme`, is more
invasive.

## 2. The open design question: contrast

**This is why the phase is not ready.** The natural token mapping produces an
invisible city in light mode:

- `--graph-node` is `oklch(1 0 0)` — **pure white** (`styles.css:36`).
- `--muted` is `oklch(0.968 0.007 248)` — near-white (`styles.css:22`).
- The renderer clears **transparent** (`EntityCity.tsx:103`), so the backdrop is
  `--card` = `oklch(1 0 0)` — white.
- Lighting is `AmbientLight(0.75)` + `DirectionalLight(1.1)`
  (`EntityCity.tsx:117-118`), and three 0.185 has `ColorManagement.enabled`, so
  a white building is linear 1.0 × up to 1.85 → hard-clipped to `#ffffff`.

Light mode would be white buildings on a white plate on a white card, outlined
in `#dfe3ea`: a straight visual regression against today's mid-grey palette,
which reads fine. Dark mode is only marginally better — buildings `oklch(0.24)`
on a card of `oklch(0.21)` (`styles.css:67` vs `:46`), ~3% lightness separation
before lighting.

These tokens were designed for a 2D SVG where a white node sits inside a
*stroked* border on a distinct background. A lit 3D surface has neither. Options,
none yet chosen:

- pick surface tokens that actually contrast with `--card` in both themes
  (probably not the `--graph-*` set);
- theme the light intensities per mode, not just the surface colours;
- derive the surface by blending a token toward `--foreground`;
- give the city its own small set of `--city-*` tokens in `styles.css`, which
  makes the 2D/3D difference explicit instead of pretending one palette fits both.

Decide by looking at the shipped M9a city, not on paper.

## 3. What was already settled and should not be re-derived

- **The oklch→sRGB maths is correct as specified** (Ottosson's OKLab→LMS′ and
  LMS→linear-sRGB matrices, gamma `c ≤ 0.0031308 ? 12.92c : 1.055·c^(1/2.4) − 0.055`,
  gamma **then** clamp; negative linear channels take the linear branch and clamp
  to 0 rather than producing `NaN`). Lift it from the git history of this
  directory rather than re-deriving.
- **Decomposition:** a pure `cssColorToInt(css): number | null` and a pure
  `resolvePalette(read: (token: string) => string): Palette` taking a *reader*
  function, plus one thin DOM-touching hook. Pure modules are unit-testable under
  the node-environment vitest; the hook is not tested (no jsdom) and must
  therefore be trivial.
- **`export type Palette = typeof PALETTE` does not typecheck** — `PALETTE` is
  `as const`, so that type is literal ints and computed numbers won't satisfy it.
  Use `Record<keyof typeof PALETTE, number>` or an explicit interface.
- **`getPropertyValue` results need `.trim()`** — computed custom properties can
  carry leading whitespace, and without trimming every token silently returns
  `null` and you get the fallback palette with no error.
- **Keep `PALETTE` as the fallback** for any token that is missing or
  unparseable, and keep the existing test that asserts its entries are valid
  24-bit ints (`apps/web/test/scene3d.test.ts:207`) green.
- **`--graph-hub` exists but the city draws no hub distinction.** Do not invent
  one.
- **Rebuild vs mutate:** adding `palette` to `EntityCity`'s `useLayoutEffect`
  deps (`:214`) rebuilds the entire scene per theme switch — under `StrictMode`
  that is roughly four construct/destroy cycles per mount. The palette feeds only
  five material colours (`EntityCity.tsx:125-127, 153, 158, 167-168`), so
  `material.color.setHex(…)` + `render()` is a ~10-line effect with no teardown.
  Prefer mutation; if you rebuild, justify it. Either way it will not leak WebGL
  contexts — the existing teardown was reviewed and is sound.

## 4. The testing gap to solve, not ignore

Nothing unit-testable can catch the §1 ordering bug: the hook is the only
DOM-touching piece, there is no jsdom, and an e2e test that only asserts the
toggle mounts something asserts nothing about colour. Plan an actual check —
a canvas pixel read after a theme switch, or a `data-psq` palette-debug
attribute compared against `documentElement.classList`. Decide this during
planning, not after.

## Likely files touched

`apps/web/src/lib/color.ts` (new), `apps/web/src/lib/scene3d.ts`,
`apps/web/src/lib/useScenePalette.ts` (new), `apps/web/src/lib/theme.tsx`,
`apps/web/src/components/EntityCity.tsx`, `apps/web/test/color.test.ts` (new),
`apps/web/test/palette.test.ts` (new), possibly `apps/web/src/styles.css`,
`e2e/psq.e2e.ts`, `README.md`.
