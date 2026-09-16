using Refs.Api.Models;

namespace Refs.Api.Controllers;

/// G15's subject: a class this repo declares that is not an entity. Declared
/// in this file rather than its own so the fixture holds exactly the files the
/// plan names.
public class CourseSlug
{
    public string Value { get; set; } = "";
}

public class CoursesController
{
    public void Slug()
    {
        // G15. `CourseSlug` is in the repo's type index and is not an entity,
        // so it must yield nothing. The control is on the next line.
        CourseSlug slug = null!;
        Course subject = null!;
        _ = (slug, subject);
    }

    // G17. Two methods on ONE physical line, both naming the same entity with
    // the same via. This is the only construct that can tie on
    // entity+file+line+via, and without it the comparator's `method` key is
    // unreachable code.
    public void Left() { Course a = null!; _ = a; } public void Right() { Course b = null!; _ = b; }
}
