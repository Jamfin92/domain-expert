using Microsoft.EntityFrameworkCore;
using Mini.Api.Models.Entities;

namespace Mini.Api.Data;

/// <summary>
/// Deliberately mixes both EF configuration styles and both DbSet property
/// forms, and includes an interpolated raw string, so the fixture exercises
/// every construct psq's C# reader has to survive.
/// </summary>
public class MiniDbContext : DbContext
{
    public MiniDbContext(DbContextOptions<MiniDbContext> options) : base(options) { }

    // expression-bodied form
    public DbSet<Student> Students => Set<Student>();
    public DbSet<Course> Courses => Set<Course>();

    // classic auto-property form
    public DbSet<Department> Departments { get; set; }
    public DbSet<Advisor> Advisors { get; set; }
    public DbSet<Enrollment> Enrollments { get; set; }

    public string DiagnosticsJson { get; set; } = $$"""{"note":"braces {{"in"}} a raw string must not break parsing;"}""";

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // nested style
        builder.Entity<Enrollment>(entity =>
        {
            entity.HasKey(e => new { e.StudentId, e.CourseId });

            entity.HasOne(e => e.Student)
                  .WithMany(s => s.Enrollments)
                  .HasForeignKey(e => e.StudentId)
                  .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Course)
                  .WithMany(c => c.Enrollments)
                  .HasForeignKey(e => e.CourseId)
                  .OnDelete(DeleteBehavior.Restrict);
        });

        // flat style
        builder.Entity<Course>()
            .HasOne(c => c.Department)
            .WithMany(d => d.Courses)
            .HasForeignKey(c => c.DepartmentId);

        builder.Entity<Course>()
            .HasIndex(c => c.Code)
            .IsUnique();

        builder.Entity<Student>()
            .HasOne(s => s.Advisor)
            .WithMany(a => a.Students)
            .HasForeignKey(s => s.AdvisorId)
            .IsRequired(false);

        builder.Entity<Student>()
            .Property(s => s.Gpa)
            .HasPrecision(3, 2);

        builder.Entity<Student>()
            .HasIndex(s => s.Email)
            .IsUnique();
    }
}
