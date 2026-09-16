using Refs.Api.Data;
using Refs.Api.Models;

namespace Refs.Api.Controllers;

public class StudentsController
{
    private readonly RefsDbContext _db = null!;

    public void Create()
    {
        // G17. Two DIFFERENT vias on one line — `_db.Students` is a
        // `dbSetName` match and `Student` an `entityName` one — so the two
        // refs tie on entity+file+line and the comparator's `via` key decides
        // their order. Nothing else in this fixture produces that tie.
        //
        // The entityName match is written FIRST on the line on purpose.
        // Measured: with `_db.Students.Add(new Student())` the walker emits
        // the two in the order the comparator would have put them anyway, so
        // dropping the `via` key changed nothing and the mutant that deletes
        // it stayed green. A tie whose emission order already matches is not
        // a reachable sort key.
        Student created = _db.Students.Add(new Student()).Entity;
        _ = created;
    }

    public void Pair()
    {
        // G11. Two mentions on ONE line collapse to a single ref...
        Student first = null!; Student second = null!;
        // G10. ...and two mentions on two lines do not.
        Student third = null!;
        _ = (first, second, third);
    }

    public void Names()
    {
        // G14. None of these three is a reference. `StudentDto` is simply a
        // different name; the two string tokens carry their own delimiters
        // (`lex.ts:133,157,212`), so neither one's text can ever equal
        // `Student`. Substring matching would report all three.
        StudentDto dto = null!;
        string plain = "Student";
        string interpolated = $"{Student}";
        _ = (dto, plain, interpolated);
    }

    public void Locals()
    {
        // G12. Lowercase `student` is a different name; the match is exact.
        int student = 0;
        // G13. A bare `Students` with no leading `.` is a local, not the set.
        int Students = 0;
        // The controls for both, in this same method.
        Student real = null!;
        _ = _db.Students;
        _ = (student, Students, real);
    }
}
