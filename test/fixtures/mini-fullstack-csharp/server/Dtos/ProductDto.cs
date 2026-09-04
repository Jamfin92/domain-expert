namespace Mini.Shop.Dtos;

/// <summary>
/// Shares its NAME with the TypeScript interface in
/// client/src/types/product-dto.ts, and differs from it only by casing — the
/// same DTO written twice in two naming conventions. The merged graph must
/// carry both, keyed by file. A merge that deduped shapes by name would delete
/// one of these two real facts and could not say deterministically which.
/// </summary>
public class ProductDto
{
    public int Id { get; set; }

    public string Name { get; set; } = "";

    public decimal Price { get; set; }

    public string? Description { get; set; }
}
