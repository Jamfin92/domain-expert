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
    //
    // `Zulu` is written FIRST, and that is the whole point. The walker emits
    // in source order and `Array.prototype.sort` is stable, so a tie written
    // in ascending order comes out ascending whether the comparator has a
    // `method` key or not — measured: with `Left` before `Right`, deleting
    // the key changed no assertion in the suite. Only a tie written in
    // DESCENDING order can observe it.
    public void Zulu() { Course a = null!; _ = a; } public void Alpha() { Course b = null!; _ = b; }
}
