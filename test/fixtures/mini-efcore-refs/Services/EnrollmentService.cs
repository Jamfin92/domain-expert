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
// D-Hb-6, the `file` component of the dedupe key — the last component that had
// no mutant, and the reason this file is padded out to the length of
// `Controllers/CoursesController.cs`.
//
// The dedupe key is `entity|file|line|type|method|via`, six fields, and under
// rule 1 each one is a separate claim. Review round 1 deleted all six in turn
// and found three dead: `type` (the reviewer's finding), `entity`, and this
// one. The first two were gated then. This one was written off in the audit,
// the plan amendment and the gate file with the same unmeasured
// because-clause — "it needs a new fixture file" — which review round 2
// disproved by building it in the two files the phase already edits.
//
// Collapsing on `file` needs two refs identical in entity, line, type, method
// and via, in two DIFFERENT files. So: one class of the same name, with a
// method of the same name, mentioning the same entity the same way, declared
// at the SAME LINE NUMBER in both files. `Dup.Sync` below and its twin in
// CoursesController.cs are that pair, both on line 55.
//
// The two line numbers MUST stay equal. Add or remove a line above this
// point in either file and the pair stops tying on `line` — caught loudly:
// `entity-refs.test.ts` pins `line: DUP_LINE` for both rows AND filters the
// `file` gate on it, so drift reddens three tests before any mutant runs.
// Round 2's note here said drift would leave the gate quietly green; round 3
// measured that and it is false. The test that reads this line back from
// source is a diagnostic that names the cause, not the thing that catches it.
//
// Two same-named classes in different namespaces is also, incidentally, the
// shape `resolveType` exists to disambiguate. It never looks `Dup` up: only
// entity names are resolved, and `Dup` is not one.
public class Dup { public void Sync() { Course d = null!; _ = d; } }
