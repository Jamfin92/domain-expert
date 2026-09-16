using Microsoft.EntityFrameworkCore;
using Refs.Api.Models;

namespace Refs.Api.Data;

public class RefsDbContext : DbContext
{
    public RefsDbContext(DbContextOptions<RefsDbContext> options) : base(options) { }

    public DbSet<Student> Students { get; set; }
    public DbSet<Course> Courses { get; set; }

    // G7's positive control, and it has to live on THIS class: "no ref names
    // OnModelCreating" would otherwise pass just as well if the walker skipped
    // the whole context type.
    public void SeedFirstCourse()
    {
        Course seeded = null!;
        _ = seeded;
    }

    // G7/G21. Both entities are named in here, and neither may produce a ref:
    // `entityConfigs` already consumes this body and turns it into relations,
    // keys and indexes (D-Hb-5).
    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Student>()
            .HasIndex(s => s.Name);

        builder.Entity<Course>()
            .HasIndex(c => c.Title);
    }
}
