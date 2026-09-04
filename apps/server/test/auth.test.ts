import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Workspace } from "../src/workspace.js";

/**
 * The bearer gate. It is opt-in at `createApp`, so this file also carries the
 * control that proves it stays off when nobody asks for it — the reason
 * api.test.ts, the desktop shell and `pnpm dev:server` did not have to change.
 */

const TOKEN = "0123456789abcdef0123456789abcdef";

const made: Workspace[] = [];
function build(token?: string) {
  const w = new Workspace(() => "2026-01-01T00:00:00.000Z");
  made.push(w);
  return createApp(w, token === undefined ? {} : { token }).app;
}
afterEach(() => {
  for (const w of made.splice(0)) w.closeAll();
});

describe("with a token configured", () => {
  it("refuses a request with no Authorization header", async () => {
    const res = await request(build(TOKEN)).get("/api/health");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
    expect(res.headers["www-authenticate"]).toBe("Bearer");
  });

  it("refuses the wrong token", async () => {
    const res = await request(build(TOKEN))
      .get("/api/health")
      .set("authorization", `Bearer ${"f".repeat(32)}`);
    expect(res.status).toBe(401);
  });

  it("refuses another scheme carrying the right secret", async () => {
    const res = await request(build(TOKEN))
      .get("/api/health")
      .set("authorization", `Basic ${TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("refuses a comma-joined value rather than accepting its first half", async () => {
    const res = await request(build(TOKEN))
      .get("/api/health")
      .set("authorization", `Bearer ${TOKEN}, Bearer ${TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("reads only the first of two Authorization header lines", async () => {
    // Node keeps the first Authorization line and discards later ones rather
    // than joining them, so a second header can neither append to the first
    // nor override it. Verified here on real header lines (supertest sends an
    // array as two lines) so the assumption is checked, not assumed.
    const app = build(TOKEN);
    const first = await request(app)
      .get("/api/health")
      .set("Authorization", [`Bearer ${TOKEN}`, `Bearer ${"f".repeat(32)}`]);
    expect(first.status).toBe(200);

    const second = await request(app)
      .get("/api/health")
      .set("Authorization", [`Bearer ${"f".repeat(32)}`, `Bearer ${TOKEN}`]);
    expect(second.status).toBe(401);
  });

  it("accepts the right token, case-insensitively on the scheme", async () => {
    const app = build(TOKEN);
    const res = await request(app).get("/api/health").set("authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const lower = await request(app).get("/api/health").set("authorization", `bearer ${TOKEN}`);
    expect(lower.status).toBe(200);
  });

  it("gates a route it has never heard of, because the mount is the whole /api tree", async () => {
    const app = build(TOKEN);
    expect((await request(app).get("/api/does-not-exist")).status).toBe(401);
    expect((await request(app).get("/api")).status).toBe(401);
    // A traversal-shaped path must not walk out from under the mount.
    expect((await request(app).get("/api/../api/health")).status).toBe(401);
  });

  it("still parses a JSON body once authorized, so the gate sits above express.json", async () => {
    // The path is wrong on purpose: a 400 naming the directory proves the body
    // was read and routed, which a 401 or a 500 would not.
    const res = await request(build(TOKEN))
      .post("/api/repos")
      .set("authorization", `Bearer ${TOKEN}`)
      .send({ path: "/nope/not/here" });
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No such directory");
  });
});

describe("with no token configured", () => {
  it("is exactly the open app it has always been", async () => {
    const res = await request(build()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
