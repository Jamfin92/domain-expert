using System.ComponentModel.DataAnnotations;

namespace Mini.Api.Models.Entities;

public class Student
{
    public int Id { get; set; }

    [Required]
    [MaxLength(80)]
    public required string Name { get; set; }

    [MaxLength(120)]
    public string? Email { get; set; }

    /// <summary>Grade point average on a 4.0 scale.</summary>
    public decimal Gpa { get; set; }

    public DateTimeOffset EnrolledAt { get; set; }

    public int? AdvisorId { get; set; }
    public Advisor? Advisor { get; set; }

    public ICollection<Enrollment> Enrollments { get; set; } = [];
}
