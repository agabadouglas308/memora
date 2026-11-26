import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
  document: { updateMany: vi.fn() },
  message: { updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma }));

const auth = vi.hoisted(() => ({
  createSession: vi.fn(() => "session-token"),
  hashPassword: vi.fn(() => "hashed-password"),
  verifyPassword: vi.fn(() => true),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/auth", () => auth);

import { POST as register } from "./register/route";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { GET as me } from "./me/route";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/auth", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.createSession.mockReturnValue("session-token");
  auth.verifyPassword.mockReturnValue(true);
  prisma.user.create.mockResolvedValue({ id: "user-1", email: "user@example.com" });
  prisma.user.count.mockResolvedValue(2);
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.document.updateMany.mockResolvedValue({ count: 0 });
  prisma.message.updateMany.mockResolvedValue({ count: 0 });
});

describe("register", () => {
  it("rejects invalid email and short passwords", async () => {
    expect((await register(post({ email: "bad", password: "longenough" }))).status).toBe(400);
    expect((await register(post({ email: "a@b.com", password: "short" }))).status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "other" });
    expect((await register(post({ email: "user@example.com", password: "longenough" }))).status).toBe(409);
  });

  it("creates an account, sets a session, and claims legacy data for the first user", async () => {
    prisma.user.count.mockResolvedValue(1);
    const response = await register(post({ email: "USER@example.com", password: "longenough" }));

    expect(response.status).toBe(201);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: "user@example.com", passwordHash: "hashed-password" },
      select: { id: true, email: true },
    });
    expect(prisma.document.updateMany).toHaveBeenCalledWith({ where: { userId: null }, data: { userId: "user-1" } });
    expect(auth.setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("does not claim legacy data for later users", async () => {
    await register(post({ email: "user@example.com", password: "longenough" }));
    expect(prisma.document.updateMany).not.toHaveBeenCalled();
  });
});

describe("login", () => {
  it("rejects an unknown user or wrong password with the same message", async () => {
    const unknown = await login(post({ email: "nobody@example.com", password: "password123" }));
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "user@example.com", passwordHash: "hash" });
    auth.verifyPassword.mockReturnValue(false);
    const wrong = await login(post({ email: "user@example.com", password: "password123" }));

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it("sets a session on success", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "user@example.com", passwordHash: "hash" });
    const response = await login(post({ email: "user@example.com", password: "password123" }));
    expect(response.status).toBe(200);
    expect(auth.setSessionCookie).toHaveBeenCalledTimes(1);
  });
});

describe("me and logout", () => {
  it("returns 401 without a session", async () => {
    auth.getCurrentUser.mockResolvedValue(null);
    expect((await me(new NextRequest("http://localhost/api/auth/me"))).status).toBe(401);
  });

  it("returns the current user", async () => {
    auth.getCurrentUser.mockResolvedValue({ id: "user-1", email: "user@example.com" });
    const response = await me(new NextRequest("http://localhost/api/auth/me"));
    expect((await response.json()).user.email).toBe("user@example.com");
  });

  it("clears the session cookie", async () => {
    expect((await logout()).status).toBe(204);
    expect(auth.clearSessionCookie).toHaveBeenCalledTimes(1);
  });
});
