# M9a — progress

Status: **shipped and reviewed (verdict: ship).** Uncommitted at the time of
writing; HEAD was 3fc3f8d.

## What shipped

The entity city now renders in the web UI behind a 2D/3D toggle. Colours are
still the hardcoded grey `PALETTE` — that was the point of the split.

- `apps/web/src/views/Dashboard.tsx` — sixth `Promise.all` leg
  `api.layout3d(repo.id).catch(() => null)`; `layout3d` and `dim` reset inside
  the `[repo.id]` effect behind the same `cancelled` guard as the other five
  slots; segmented `2D`/`3D` control (`data-psq="dim-toggle" | "dim-2d" |
  "dim-3d"`, `aria-pressed`) rightmost in the card header with the existing
  badge/hint kept to its left and gated on `dim === "2d"`; render swap inside
  the same fixed-height `CardContent`. Selection stays 2D-only.
- `apps/web/src/components/EntityCity.tsx` — comment-only hunk. The "later
  phase" line now says no picking and no orbit controls is deliberate.
- `e2e/psq.e2e.ts` — one test, `switches the graph between 2D and 3D and back`.
  Asserts `city + fallback === 1`, never that WebGL succeeded.
- `README.md` — M9 row split into M9a (done) / M9b (planned); the stale
  drift-oracle entry dropped from "Next" and the list renumbered.

## Verification (reproduced independently by the reviewer)

`pnpm typecheck` pass · `pnpm test` 200 passed · `PSQ_NO_CORPUS=1 pnpm test`
145 passed / 55 skipped · `pnpm test:e2e` 17 passed (was 16).

Note for anyone running these: bare `pnpm` is not on PATH in this shell. Use
`corepack pnpm` (Node v24.19.0 via fnm).

## Decisions made

- **The 3D leg must never reject.** The loader is all-or-nothing, so a
  `/layout3d` failure would otherwise blank the whole dashboard. Verified: `call`
  in `apps/web/src/lib/api.ts` is `async`, so nothing throws past the inline
  `.catch`.
- **The 3D button is disabled while `layout3d` is null**, and the render swap
  falls through to 2D anyway — `EntityCity` can never mount without a layout.
- **The WebGL fallback is horizontally centred (`py-24 text-center`), not
  vertically.** Deliberate deviation: `EntityCity`'s fallback wrapper has no
  height class and the plan forbade editing that file, so `h-full` from outside
  would resolve against an auto-height parent and do nothing.

## What M9b needs to know

The contrast question in `../m9b-theme-colours/plan.md` §2 can now be answered by
looking at the screen. Two readings of the shipped city, both worth checking
rather than trusting:

- The implementer, from screenshots in both themes: light mode reads clearly
  (slate buildings on a darker district slab against the white card); **dark mode
  is the weak side** — the district ground plate nearly vanishes against the
  near-black card, and FK edge lines and direction cones are faint in both
  themes. That is the *inverse* of the white-on-white failure M9b was written to
  fear.
- The reviewer's caveat: the plate is `0x6b7280`, a mid-grey whose contrast
  against a near-black card is comparable to its contrast against a white one, so
  "nearly vanishes" may be a **lighting** artifact rather than a colour one. If
  so, the fix is per-theme light intensities, not just surface tokens.

Non-blocking items from the M9a review, to fold into M9b rather than a new phase:

1. The disabled 3D button's `title` can never show — shadcn's base class sets
   `disabled:pointer-events-none` (`apps/web/src/components/ui/button.tsx:8`).
   Needs a wrapper span or `aria-describedby` if the affordance is wanted.
2. The 3D fetch failure is swallowed silently; one `console.warn` in the catch
   would cost nothing and keep the never-reject property.
3. `dim-toggle` has no `role="group"` / `aria-label`.
4. `selected` is treated two ways in 3D: the header badge/hint is hidden, but the
   right-hand aside still shows the stale selection detail.
5. Nothing asserts the city is non-blank — a renderer regression producing an
   empty canvas still passes. This follows from the plan's correct "do not assert
   WebGL succeeded", and overlaps M9b §4's testing gap.
6. `scene3d.ts:12` still says "phase 2b swaps these for theme-derived values" —
   stale naming, pinned by M9a's constraints, M9b's to clean up.
