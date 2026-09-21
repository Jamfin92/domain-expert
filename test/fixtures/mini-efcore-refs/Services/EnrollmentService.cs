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

/// H-e Gap-1 — the receiver-position rule's only positive control outside the
/// private corpus. Before this class the fixture matched the rule ZERO times,
/// so a gate built on it would have passed by finding nothing.
///
/// This models the MEASURED phenomenon and not a different one. In the corpus
/// all 14 matches are a property whose name collides with an entity's, read off
/// a receiver — there, a property inherited from a framework base class; here,
/// one declared on this class. The walker cannot tell those two apart: it has
/// no symbol table, which is the whole reason the rule is syntactic.
///
/// Round 1 wrote this case as `Student.Empty` — a static-member access on the
/// entity TYPE. That is the shape the plan and `entity-refs.ts` both record as
/// a TOLERATED LIMITATION, so pinning "no ref" for it asserted the wrong
/// answer and put the fixture at odds with the doc comment. Fixed in round 2.
///
/// `Student` in `Read` has `prev != "."` and `next == "."`. Without the rule
/// the line is one `entityName` ref; with it, none (M4). The property
/// DECLARATION contributes nothing either way — the walker reads method
/// bodies only.
///
/// The mention in `Read` MUST stay alone on its line. The dedupe key is
/// `entity|file|line|type|method|via` and excludes token position, so a second
/// `Student` mention sharing this line, type, method and via would keep the
/// row alive whatever the rule did, and M4 would never redden.
public class Receiver
{
    public string Student { get; set; } = "";

    public void Read() { _ = Student.Length; }

    /// H-e M10 — the `seen.add` ordering, which round 1 left ungated even
    /// though the plan calls it "not a style point; it changes output".
    ///
    /// TWO `Student` entityName mentions on ONE line in ONE method: the first
    /// a bare receiver (dropped), the second a genuine type mention (kept).
    /// They share the whole dedupe key, so the drop MUST happen before
    /// `seen.add`. Move the `continue` below it and the receiver poisons the
    /// key, the genuine mention dedupes away, and this line yields 0 refs
    /// instead of 1. Order matters: the receiver has to come first.
    public void Pair() { _ = Student.Length; Student other = null!; _ = other; }
}

/// H-e Gap-2 — the D-Hb-10 control, and it is MANUFACTURED: no corpus repo
/// contains this shape today. Nothing gated D-Hb-10 in either direction; the
/// suite was green both with and without it.
///
/// The expression body holds a statement lambda with its own `;`, and the
/// entity mention sits AFTER that `;`. Three readings differ:
///   - the pre-D-Hb-10 walker pushed `body: []`, so no ref at all (M1);
///   - a depth-LESS scan stops at the lambda's `;` and loses `Course` (M6);
///   - only the depth-tracked scan reaches the real terminator.
/// `typeof(Course)` is used rather than `Course.Something` on purpose: the
/// latter would be a bare receiver and Gap-1's rule would eat this control.
public class Terse
{
    public object Roster() => Pick(() => { int n = 0; _ = n; }, typeof(Course));

    private static object Pick(System.Action a, System.Type t) { a(); return t; }
}
