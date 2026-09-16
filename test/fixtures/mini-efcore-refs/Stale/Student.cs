namespace Refs.Api.Stale;

/// G19, and D-Hb-13 made visible.
///
/// A class with the SAME NAME as the entity, in a namespace the DbContext
/// never imports. `resolveType` keeps it out of the entity set — that is what
/// that function is for. The walker is name-keyed and has no symbol table, so
/// it still reports the mention below as a reference to the real
/// `Refs.Api.Models.Student`. The imprecision is gated rather than hidden;
/// `EntityRef` carries no `FactSource`, so the graph cannot label it.
public class Student
{
    public int Id { get; set; }

    public void Touch()
    {
        Student legacy = null!;
        _ = legacy;
    }
}
