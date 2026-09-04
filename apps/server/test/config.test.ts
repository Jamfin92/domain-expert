import { describe, it, expect } from "vitest";
import { resolveServerConfig } from "../src/config.js";

/**
 * The interlock: it must be impossible to expose this server without a token.
 * Every case here is a way someone could get that wrong by accident.
 */

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("resolveServerConfig", () => {
  it("defaults to loopback on 8092 with no token, which is the dev shape", () => {
    expect(resolveServerConfig({})).toEqual({ host: "127.0.0.1", port: 8092 });
  });

  it("counts localhost and ::1 as loopback too", () => {
    expect(resolveServerConfig({ PSQ_HOST: "localhost" }).host).toBe("localhost");
    expect(resolveServerConfig({ PSQ_HOST: "::1" }).host).toBe("::1");
  });

  it("trims the host, because a trailing space in an env file is invisible", () => {
    expect(resolveServerConfig({ PSQ_HOST: " 127.0.0.1 " }).host).toBe("127.0.0.1");
  });

  it("refuses a non-loopback bind with no token, and says both ways out", () => {
    expect(() => resolveServerConfig({ PSQ_HOST: "10.0.0.5" })).toThrow(/PSQ_TOKEN/);
    expect(() => resolveServerConfig({ PSQ_HOST: "10.0.0.5" })).toThrow(/127\.0\.0\.1/);
  });

  it("allows a non-loopback bind once a token is set", () => {
    expect(resolveServerConfig({ PSQ_HOST: "10.0.0.5", PSQ_TOKEN: TOKEN })).toEqual({
      host: "10.0.0.5",
      port: 8092,
      token: TOKEN,
    });
  });

  it("refuses an empty host even with a token, because empty binds everything", () => {
    expect(() => resolveServerConfig({ PSQ_HOST: "", PSQ_TOKEN: TOKEN })).toThrow(/empty/);
    expect(() => resolveServerConfig({ PSQ_HOST: "   ", PSQ_TOKEN: TOKEN })).toThrow(/empty/);
  });

  it("refuses wildcard binds even with a token", () => {
    for (const host of ["0.0.0.0", "::", "[::]"]) {
      expect(() => resolveServerConfig({ PSQ_HOST: host, PSQ_TOKEN: TOKEN })).toThrow(
        /every interface/,
      );
    }
  });

  it("refuses a token short enough to guess", () => {
    expect(() => resolveServerConfig({ PSQ_TOKEN: "x" })).toThrow(/too short/);
    expect(() => resolveServerConfig({ PSQ_TOKEN: "0123456789abcde" })).toThrow(/too short/);
    expect(resolveServerConfig({ PSQ_TOKEN: "0123456789abcdef" }).token).toBe(
      "0123456789abcdef",
    );
  });

  it("treats an unset and an empty token the same: no token", () => {
    expect(resolveServerConfig({ PSQ_TOKEN: "" }).token).toBeUndefined();
    expect(resolveServerConfig({}).token).toBeUndefined();
  });

  it("refuses a port that is not a port", () => {
    // "0x2360" and "1e3" are 9056 and 1000 to Number(), which is exactly the
    // kind of quiet reinterpretation a bound port must not do.
    for (const port of ["0", "-1", "65536", "http", "8092.5", "0x2360", "1e3", " 94 51"]) {
      expect(() => resolveServerConfig({ PSQ_PORT: port })).toThrow(/PSQ_PORT/);
    }
    expect(resolveServerConfig({ PSQ_PORT: "9451" }).port).toBe(9451);
    expect(resolveServerConfig({ PSQ_PORT: " 9451 " }).port).toBe(9451);
  });

  it("refuses a set-but-empty port, the same way it refuses an empty host", () => {
    expect(() => resolveServerConfig({ PSQ_PORT: "" })).toThrow(/PSQ_PORT/);
    expect(() => resolveServerConfig({ PSQ_PORT: "   " })).toThrow(/PSQ_PORT/);
  });

  it("trims the token, so a trailing space cannot pad a short one past the minimum", () => {
    // 16 spaces is 16 characters and zero secret.
    expect(() => resolveServerConfig({ PSQ_TOKEN: " ".repeat(16) })).not.toThrow();
    expect(resolveServerConfig({ PSQ_TOKEN: " ".repeat(16) }).token).toBeUndefined();
    expect(() => resolveServerConfig({ PSQ_TOKEN: "0123456789abcde " })).toThrow(/too short/);
    expect(resolveServerConfig({ PSQ_TOKEN: " 0123456789abcdef " }).token).toBe(
      "0123456789abcdef",
    );
  });
});
