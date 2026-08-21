namespace Mini.Api.Models.Entities;

/// <summary>Join entity with a composite key, plus a payload column.</summary>
public class Enrollment
{
    public int StudentId { get; set; }
    public Student Student { get; set; } = null!;

    public int CourseId { get; set; }
    public Course Course { get; set; } = null!;

    [MaxLength(2)]
    public string? LetterGrade { get; set; }

    public DateTimeOffset RegisteredAt { get; set; }
}
