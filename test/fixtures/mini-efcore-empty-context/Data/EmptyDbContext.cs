using Microsoft.EntityFrameworkCore;

namespace Mini.Empty.Data;

/// <summary>
/// A context that exposes nothing at all. The positive control for the
/// zero-entity warning: psq must say the model is empty rather than return an
/// empty model that reads exactly like a repo which genuinely has no entities.
///
/// It is deliberately NOT abstract and NOT Identity-derived, because both of
/// those are legitimate ways for a context to contribute no DbSet of its own.
/// </summary>
public class EmptyDbContext(DbContextOptions<EmptyDbContext> options) : DbContext(options)
{
}
