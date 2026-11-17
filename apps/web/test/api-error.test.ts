import { describe, expect, it } from "vitest";
import { ApiError, errorFromResponse } from "../src/lib/api-error.js";
import type { Coverage } from "../src/lib/api.js";

// Contents are irrelevant here: the builder passes the object through by identity.
const C = { entities: { status: "none-found" } } as unknown as Coverage;

describe("errorFromResponse", () => {
  it("a 401 reads as the token instruction", () => {
    const e = errorFromResponse(401, {}, "T");
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("T");
    expect(e.status).toBe(401);
    expect(e.code).toBeNull();
  });

  it("a body with `error` reads as that error, with no code or coverage", () => {
    const e = errorFromResponse(400, { error: "x" }, "T");
    expect(e.message).toBe("x");
    expect(e.code).toBeNull();
    expect(e.coverage).toBeNull();
  });

  it("stringifies a non-string `error`, as the client always has", () => {
    expect(errorFromResponse(400, { error: 42 }, "T").message).toBe("42");
  });

  it("the no-entities body carries its code and its coverage", () => {
    const body = { error: "No entities found: x.", code: "no-entities", coverage: C };
    const e = errorFromResponse(400, body, "T");
    expect(e.message).toBe("No entities found: x.");
    expect(e.code).toBe("no-entities");
    expect(e.coverage).toBe(C);
    expect(e.body).toBe(body);
  });

  it("no coverage on the body means coverage null, even with the code", () => {
    const e = errorFromResponse(400, { code: "no-entities" }, "T");
    expect(e.code).toBe("no-entities");
    expect(e.coverage).toBeNull();
    expect(e.message).toBe("Request failed (400)");
  });

  it("a non-JSON body reads as the status", () => {
    const e = errorFromResponse(500, "not json", "T");
    expect(e.message).toBe("Request failed (500)");
    expect(e.code).toBeNull();
    expect(e.coverage).toBeNull();
  });

  it("trusts coverage only beside its code", () => {
    const e = errorFromResponse(400, { error: "x", code: "other", coverage: C }, "T");
    expect(e.code).toBe("other");
    expect(e.coverage).toBeNull();
  });
});
