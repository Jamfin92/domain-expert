using Refs.Api.Data;
using Refs.Api.Models;

namespace Refs.Api.Services;

/// G4. The walker is not controller-scoped: a plain service class contributes
/// refs too. Its name ends in neither `Controller` nor `Context`.
public class EnrollmentService
{
    private readonly RefsDbContext _db = null!;

    public void Enroll()
    {
        Student who = null!;
        _ = _db.Courses;
        _ = who;
    }

    // D-Hb-6, the `entity` component of the dedupe key. TWO DIFFERENT entities
    // on one physical line in one method — the only such line in the fixture.
    // Drop `entity` from the key and one of the two vanishes; found ungated by
    // probing every component of the key in review round 1, after `type` was
    // found ungated by the reviewer.
    public void Both() { Student s = null!; Course c = null!; _ = (s, c); }
}
