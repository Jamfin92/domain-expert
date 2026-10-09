import { describe, expect, it } from "vitest";
import { onHitClick } from "../src/lib/lookup.js";

describe("onHitClick", () => {
  it("after 'Look up anyway' X, clicking a hit equal to the selected entity retargets the lookup", () => {
    // selected = Student (parent), target = Ghost (local lookup-anyway)
    expect(onHitClick("Student", "Student", "Ghost")).toEqual({ select: "Student", setTarget: "Student" });
  });

  it("a hit differing from selected lets the parent's prop change retarget", () => {
    expect(onHitClick("Course", "Student", "Student")).toEqual({ select: "Course", setTarget: null });
  });

  it("no redundant retarget when already looking at the hit", () => {
    expect(onHitClick("Student", "Student", "Student")).toEqual({ select: "Student", setTarget: null });
  });

  it("works from a null selection", () => {
    expect(onHitClick("Student", null, null)).toEqual({ select: "Student", setTarget: null });
  });
});
