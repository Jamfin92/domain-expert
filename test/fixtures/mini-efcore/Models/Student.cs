namespace Mini.Api.Models;

/// <summary>
/// Stale duplicate of Models/Entities/Student.cs, kept to prove the extractor
/// resolves DbSet&lt;Student&gt; through the context's using directives rather
/// than by class name. Nothing references this type.
/// </summary>
public class Student
{
    public int Id { get; set; }
    public string? FullName { get; set; }
    public string? LegacyNotes { get; set; }
    public bool Archived { get; set; }
}
