/**
 * The busiest component in this fixture: three calls, one more than either
 * Card. That strict margin is what keeps `client.busiest`'s tie guard open.
 * Same name as src/components/shop/Panel.tsx, so every component here shares
 * its name with exactly one other and every MCQ choice is file-disambiguated.
 *
 * The third call is deliberately unmatched — the server declares no
 * /api/admin/stats. Repeating a (method, path) pair instead would put two
 * identical rows under one header in the panel.
 */
export function Panel() {
  const load = async () => {
    await fetch("/api/admin/cards", { method: "POST" });
    await fetch("/api/cards");
    await fetch("/api/admin/stats");
  };
  return <aside onClick={load}>admin panel</aside>;
}
