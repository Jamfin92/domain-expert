/**
 * The TypeScript twin of server/Dtos/ProductDto.cs. Same name, same field
 * count, same optional field — spelled `description` rather than `Description`.
 */
export interface ProductDto {
  id: number;
  name: string;
  price: number;
  description?: string;
}

/**
 * A shape with exactly one collection field and three scalars, so the
 * field-collection generator has something to ask about. Its name does not
 * reduce to `Category`, so it stays unpaired and feeds the merge's
 * "not computed, not no mirror" warning.
 */
export interface CategorySummary {
  id: number;
  name: string;
  slug: string;
  products: ProductDto[];
}
