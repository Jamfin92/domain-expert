import { saveCard } from "../../lib/save-card.js";

/**
 * Attributed but UNMATCHED: the server declares no /api/shop/wishlist, so
 * `matches` stays null and no warning fires. Same name as
 * src/components/admin/Card.tsx.
 *
 * It also calls the shared saveCard() helper, so that one call is attributed
 * to both Card components at once.
 */
export function Card() {
  const load = async () => {
    await fetch("/api/shop/wishlist");
    await saveCard();
  };
  return <article onClick={load}>shop card</article>;
}
