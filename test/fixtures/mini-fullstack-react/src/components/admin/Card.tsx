/**
 * The whole point of this fixture: a call that is BOTH attributed to a
 * component and matched to a route. Same name as src/components/shop/Card.tsx
 * — only the key tells them apart, which is what the label rule needs.
 */
export function Card() {
  const save = async () => {
    await fetch("/api/admin/cards", { method: "POST" });
  };
  return <section onClick={save}>admin card</section>;
}
