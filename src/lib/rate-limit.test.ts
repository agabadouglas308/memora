import { afterEach, describe, expect, it, vi } from "vitest";
import { clientKey, rateLimit } from "./rate-limit";

afterEach(() => vi.useRealTimers());

describe("rateLimit", () => {
  it("allows calls up to the limit then blocks them", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3).allowed).toBe(true);
    expect(rateLimit(key, 3).allowed).toBe(false);
  });

  it("resets after the window expires", () => {
    vi.useFakeTimers();
    const key = `window-${Math.random()}`;
    expect(rateLimit(key, 1, 1000).allowed).toBe(true);
    expect(rateLimit(key, 1, 1000).allowed).toBe(false);
    vi.setSystemTime(Date.now() + 1001);
    expect(rateLimit(key, 1, 1000).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("combines action, identity and forwarded address", () => {
    const request = { headers: new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }) };
    expect(clientKey(request, "login", "User@Example.com")).toBe("login:user@example.com:1.2.3.4");
  });
});
