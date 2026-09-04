namespace Mini.Empty.Dtos;

public class ReportBase
{
    public int Id { get; set; }
}

/// <summary>
/// The positive control for the unterminated-header warning. `global::` is
/// valid C# that psq's hand-written reader does not consume: `readTypeRef`
/// stops at the `::`, so the header is never terminated and the three
/// properties below are never read.
///
/// That is the point of the warning. Without it this type reaches the graph
/// with zero properties, falls under MIN_PROPERTIES, and disappears with
/// nothing said — a silent wrong answer on a type that has nothing to do with
/// a DbContext. Rule 3: warn, never guess.
/// </summary>
public class WidgetDto : global::Mini.Empty.Dtos.ReportBase
{
    public string Name { get; set; } = "";
    public decimal Price { get; set; }
    public int Quantity { get; set; }
}
