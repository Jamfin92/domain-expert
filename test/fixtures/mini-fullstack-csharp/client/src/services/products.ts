import type { ProductDto } from "@/types/product-dto";

/**
 * The fetch lives HERE, not in the component. Reaching it from ProductList
 * costs one hop through a `@/`-aliased import, which resolves only under
 * client/tsconfig.json's `paths`. That is the point of the fixture.
 */
export const productsService = {
  async list(): Promise<ProductDto[]> {
    const res = await fetch("/api/products");
    return (await res.json()) as ProductDto[];
  },
};
