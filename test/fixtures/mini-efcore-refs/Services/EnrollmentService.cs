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
}
