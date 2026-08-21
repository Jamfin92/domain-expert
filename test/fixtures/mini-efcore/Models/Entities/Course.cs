namespace Mini.Api.Models.Entities;

public class Course
{
    public int Id { get; set; }

    [Required]
    [MaxLength(60)]
    public required string Title { get; set; }

    [MaxLength(12)]
    public required string Code { get; set; }

    public int Credits { get; set; }

    public int DepartmentId { get; set; }
    public Department Department { get; set; } = null!;

    public ICollection<Enrollment> Enrollments { get; set; } = [];
}
