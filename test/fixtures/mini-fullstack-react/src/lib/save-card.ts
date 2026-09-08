/**
 * Not a component: camelCase and no JSX, so `reactComponentDetector` rejects
 * it. Both Card components import and call it, so the owner walk resolves this
 * one call to TWO component keys — the fixture's multi-component control.
 */
export function saveCard() {
  return fetch("/api/cards");
}
