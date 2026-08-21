namespace Mini.Api.Models.Entities;

public class Department
{
    public int Id { get; set; }

    [Required]
    [MaxLength(40)]
    public required string Name { get; set; }

    public ICollection<Course> Courses { get; set; } = [];
}
