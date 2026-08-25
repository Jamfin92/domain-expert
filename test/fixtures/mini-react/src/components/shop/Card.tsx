/** Same name as admin/Card.tsx — only the KEY tells them apart. */
export function Card() {
  const load = async () => {
    await fetch("/api/shop/cards");
  };
  return <article onClick={load}>shop card</article>;
}
