namespace Mini.Library.Dtos;

/// <summary>A bodyless record: correctly terminated by `;`, must stay silent.</summary>
public record SummaryDto(int Id);

/// <summary>
/// Base arguments on a record. Records are not a separate code path in the
/// reader, so this truncated exactly like the context did: `AuthorName` and
/// `LoanCount` were dropped and only the positional parameters survived.
/// </summary>
public record BookSummaryDto(int Id, string Title) : SummaryDto(Id)
{
    public string AuthorName { get; init; } = "";
    public int LoanCount { get; init; }
}

public interface ITimestamped
{
    DateTimeOffset UpdatedAt { get; }
}

public class ReportBase(int id)
{
    public int Id { get; init; } = id;
}

/// <summary>
/// An interface AFTER the base argument list. `ITimestamped` was silently
/// missing from `bases`, which is what breaks Identity detection on a repo
/// writing `: IdentityDbContext<...>(options), ISomething`.
/// </summary>
public class LoanReportDto(int id) : ReportBase(id), ITimestamped
{
    public DateTimeOffset UpdatedAt { get; init; }
    public int OverdueCount { get; init; }
    public decimal TotalFees { get; init; }
}
