/**
 * One call — the fixture's lowest per-component count, and the other half of
 * the `Panel` name collision. Same name as
 * src/components/admin/Panel.tsx, distinguished only by key.
 */
export function Panel() {
  const refresh = async () => {
    await fetch("/api/cards");
  };
  return <div onClick={refresh}>shop panel</div>;
}
