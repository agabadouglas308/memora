import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const prisma = vi.hoisted(() => ({
  document: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  chunk: {
    create: vi.fn(),
    count: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma }));

const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth", () => auth);

import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";

function uploadRequest(file: File) {
  const form = new FormData();
  form.append("file", file);
  return new NextRequest("http://localhost/api/documents", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getCurrentUser.mockResolvedValue({ id: "user-1", email: "user@example.com" });
  prisma.$executeRaw.mockResolvedValue(1);
  prisma.document.count.mockResolvedValue(0);
  prisma.document.create.mockResolvedValue({});
  prisma.document.findMany.mockResolvedValue([]);
  prisma.document.deleteMany.mockResolvedValue({ count: 1 });
  prisma.chunk.create.mockResolvedValue({});
  prisma.chunk.count.mockResolvedValue(0);
  prisma.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
});

describe("authentication", () => {
  it("rejects unauthenticated document access", async () => {
    auth.getCurrentUser.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/documents"))).status).toBe(401);
    expect((await POST(uploadRequest(new File(["some text content here"], "notes.txt", { type: "text/plain" })))).status).toBe(401);
    expect((await DELETE(new NextRequest("http://localhost/api/documents/doc-1", { method: "DELETE" }), { params: { id: "doc-1" } })).status).toBe(401);
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/documents", () => {
  it("seeds the demo document once on a fresh database", async () => {
    const response = await GET(new NextRequest("http://localhost/api/documents"));

    expect(response.status).toBe(200);
    expect(prisma.document.create).toHaveBeenCalledTimes(1);
    expect(prisma.chunk.create.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not seed when another request already claimed the seed", async () => {
    prisma.$executeRaw.mockResolvedValue(0);

    await GET(new NextRequest("http://localhost/api/documents"));

    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(prisma.chunk.create).not.toHaveBeenCalled();
  });

  it("does not reseed after the last document was deleted", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.document.count.mockResolvedValue(0);

    const response = await GET(new NextRequest("http://localhost/api/documents"));

    expect((await response.json()).documents).toEqual([]);
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it("does not seed an existing library", async () => {
    prisma.document.count.mockResolvedValue(2);
    prisma.document.findMany.mockResolvedValue([
      { id: "doc-1", name: "notes.txt", _count: { chunks: 3 } },
    ]);

    await GET(new NextRequest("http://localhost/api/documents"));

    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it("warns when no chunks match the active embedding model", async () => {
    prisma.document.count.mockResolvedValue(1);
    prisma.document.findMany.mockResolvedValue([
      { id: "doc-1", name: "notes.txt", _count: { chunks: 3 } },
    ]);
    prisma.chunk.count.mockResolvedValue(0);

    const data = await (await GET(new NextRequest("http://localhost/api/documents"))).json();
    expect(data.warning).toContain("Re-upload them");
  });
});

describe("POST /api/documents", () => {
  it("rejects a request with no file", async () => {
    const response = await POST(new NextRequest("http://localhost/api/documents", { method: "POST", body: new FormData() }));
    expect(response.status).toBe(400);
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed multipart body", async () => {
    const response = await POST(new NextRequest("http://localhost/api/documents", {
      method: "POST",
      body: "not a form",
      headers: { "Content-Type": "application/json" },
    }));
    expect(response.status).toBe(400);
  });

  it("rejects unsupported file types", async () => {
    const file = new File(["MZ binary content"], "malware.exe", { type: "application/octet-stream" });
    const response = await POST(uploadRequest(file));
    expect(response.status).toBe(400);
  });

  it("rejects files over 10 MB", async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" });
    const response = await POST(uploadRequest(file));
    expect(response.status).toBe(400);
  });

  it("stores a text upload and its chunks atomically", async () => {
    const file = new File(
      ["Atlas stores research notes. Retrieval finds the relevant passages. Overlap keeps context."],
      "notes.txt",
      { type: "text/plain" }
    );
    const response = await POST(uploadRequest(file));

    expect(response.status).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect((await response.json()).document.name).toBe("notes.txt");
  });
});

describe("DELETE /api/documents/:id", () => {
  it("returns 404 for an unknown document", async () => {
    prisma.document.deleteMany.mockResolvedValue({ count: 0 });
    const response = await DELETE(new NextRequest("http://localhost/api/documents/missing", { method: "DELETE" }), {
      params: { id: "missing" },
    });
    expect(response.status).toBe(404);
  });

  it("returns 204 when a document is deleted", async () => {
    const response = await DELETE(new NextRequest("http://localhost/api/documents/doc-1", { method: "DELETE" }), {
      params: { id: "doc-1" },
    });
    expect(response.status).toBe(204);
    expect(prisma.document.deleteMany).toHaveBeenCalledWith({ where: { id: "doc-1", userId: "user-1" } });
  });
});
