namespace Mini.Api.Models.Entities;

public class Advisor
{
    public int Id { get; set; }

    [Required]
    [MaxLength(80)]
    public required string Name { get; set; }

    public ICollection<Student> Students { get; set; } = [];
}
