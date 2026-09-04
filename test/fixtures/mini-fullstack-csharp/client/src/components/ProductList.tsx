import { productsService } from "@/services/products";

/**
 * The positive control for root selection. This component's only link to the
 * `GET /api/products` call site is the `@/services/products` import above. Read
 * the TypeScript side from the FIXTURE ROOT instead of from client/ and the
 * alias does not resolve, the reference graph never connects the two files, and
 * the call comes back with `components: []` — indistinguishable from a call
 * nothing owns. Every other count in this fixture survives that mistake.
 */
export function ProductList() {
  const load = () => productsService.list();
  return <ul onClick={load}>products</ul>;
}
