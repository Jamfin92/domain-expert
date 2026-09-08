/**
 * Attributed but UNMATCHED: the server declares no /api/shop/wishlist, so
 * `matches` stays null and no warning fires. Same name as
 * src/components/admin/Card.tsx.
 */
export function Card() {
  const load = async () => {
    await fetch("/api/shop/wishlist");
  };
  return <article onClick={load}>shop card</article>;
}
