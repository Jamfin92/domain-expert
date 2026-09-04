using Microsoft.EntityFrameworkCore;
using Mini.Library.Models;

namespace Mini.Library.Data;

/// <summary>
/// A C# 12 primary constructor AND a base constructor argument list, with a
/// further interface after it: `: DbContext(options), ILibraryContext`.
///
/// This is the construct that used to truncate the header. `readTypeRef` stops
/// on the `(` of `DbContext(options)`, so the reader never reached the `{`,
/// emitted the context through the bodyless branch, and produced a context
/// with NO DbSets, NO methods and NO second base — while `contextName` still
/// resolved, because `bases` had already collected "DbContext". The result was
/// an empty entity model indistinguishable from a repo that has none.
/// </summary>
public class LibraryDbContext(DbContextOptions<LibraryDbContext> options)
    : DbContext(options), ILibraryContext
{
    public DbSet<Author> Authors => Set<Author>();
    public DbSet<Book> Books { get; set; }
    public DbSet<Loan> Loans { get; set; }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Book>()
            .HasOne(b => b.Author)
            .WithMany(a => a.Books)
            .HasForeignKey(b => b.AuthorId)
            .OnDelete(DeleteBehavior.Restrict);

        // An explicit table name must beat the DbSet name `Loans`. Pinned
        // hermetically here because the only other ToTable assertion in the
        // suite is corpus-gated and does not run on a clean checkout.
        builder.Entity<Loan>()
            .ToTable("Loan Records");

        builder.Entity<Loan>()
            .HasOne(l => l.Book)
            .WithMany(b => b.Loans)
            .HasForeignKey(l => l.BookId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
