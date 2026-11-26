import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSession, hashPassword, readSession, verifyPassword } from "./auth";

describe("passwords", () => {
  it("hashes with a salt and verifies the original password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(hashPassword("correct horse battery staple")).not.toBe(stored);
    expect(verifyPassword(stored, "correct horse battery staple")).toBe(true);
    expect(verifyPassword(stored, "wrong password")).toBe(false);
  });

  it("rejects malformed stored values", () => {
    expect(verifyPassword("broken", "anything")).toBe(false);
  });
});

describe("sessions", () => {
  it("round-trips a valid token", () => {
    expect(readSession(createSession("user-1"))).toBe("user-1");
  });

  it("rejects tampered and malformed tokens", () => {
    const [payload, signature] = createSession("user-1").split(".");
    expect(readSession(`${payload}.${signature.slice(0, -1)}x`)).toBeNull();
    expect(readSession("garbage")).toBeNull();
    expect(readSession(undefined)).toBeNull();
  });

  it("rejects an expired token", () => {
    const payload = Buffer.from(JSON.stringify({ uid: "user-1", exp: Date.now() - 1000 })).toString("base64url");
    const signature = createHmac("sha256", "memora-development-secret-change-me")
      .update(payload)
      .digest("base64url");
    expect(readSession(`${payload}.${signature}`)).toBeNull();
  });
});
