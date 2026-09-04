namespace Mini.Library.Models;

public class Loan
{
    public int Id { get; set; }

    public int BookId { get; set; }
    public Book? Book { get; set; }

    public DateTimeOffset TakenAt { get; set; }
    public DateTimeOffset? ReturnedAt { get; set; }
}
