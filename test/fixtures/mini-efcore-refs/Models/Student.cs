namespace Refs.Api.Models;

public class Student
{
    public int Id { get; set; }

    public string? Name { get; set; }

    public int? CourseId { get; set; }

    // G6. A navigation property typed `Course`, outside any method body.
    // Property and field declarations are not scanned, by design: relations
    // already model this edge, and reporting it as a reference would say the
    // declaration of a link is a use of it.
    public Course? Course { get; set; }
}
