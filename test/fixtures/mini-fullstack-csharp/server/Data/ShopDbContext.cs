using Microsoft.EntityFrameworkCore;
using Mini.Shop.Models;

namespace Mini.Shop.Data;

/// <summary>
/// The .NET half of the full-stack fixture. Deliberately ordinary: nothing
/// here is a parser edge case, because this fixture exists to test DETECTION
/// and the MERGE, not C# parsing. Two DbSets and one fluent relation are
/// enough for the merged graph to have a real entity model to be wrong about.
/// </summary>
public class ShopDbContext : DbContext
{
    public DbSet<Category> Categories { get; set; }
    public DbSet<Product> Products { get; set; }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Product>()
            .HasOne(p => p.Category)
            .WithMany(c => c.Products)
            .HasForeignKey(p => p.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
