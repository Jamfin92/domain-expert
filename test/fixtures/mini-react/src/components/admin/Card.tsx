/** Same name as shop/Card.tsx — only the KEY tells them apart. */
export function Card() {
  const save = async () => {
    await fetch("/api/admin/cards", { method: "POST" });
  };
  return <section onClick={save}>admin card</section>;
}
