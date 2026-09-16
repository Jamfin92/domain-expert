namespace Refs.Api.Stale;

/// G19, and D-Hb-13 made visible.
///
/// The directory is `_Stale` and not `Stale` for a second, unrelated reason:
/// `_` sorts AFTER every letter by code unit and BEFORE every letter under
/// ICU collation, so this is the one pair of file paths in the fixture whose
/// order differs between the two. Without it, swapping the comparator to the
/// `localeCompare` sitting four lines from it in `dotnet.ts` changed no
/// assertion in the suite. Measured, not assumed.
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
