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
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma }));

import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";

function uploadRequest(file: File) {
  const form = new FormData();
  form.append("file", file);
  return new NextRequest("http://localhost/api/documents", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.document.create.mockResolvedValue({ id: "doc-1", name: "notes.txt", type: "text/plain", size: 10 });
  prisma.document.deleteMany.mockResolvedValue({ count: 1 });
  prisma.chunk.create.mockResolvedValue({ id: "chunk-1" });
  prisma.document.findMany.mockResolvedValue([]);
});

describe("GET /api/documents", () => {
  it("seeds a demo document and chunks an empty database", async () => {
    prisma.document.count.mockResolvedValue(0);
    const response = await GET();

    expect(response.status).toBe(200);
    expect(prisma.document.create).toHaveBeenCalledTimes(1);
    expect(prisma.chunk.create.mock.calls.length).toBeGreaterThan(1);
    expect((await response.json()).documents).toEqual([]);
  });

  it("does not reseed when documents already exist", async () => {
    prisma.document.count.mockResolvedValue(2);
    prisma.document.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: "doc-1", name: "notes.txt", _count: { chunks: 3 } }]);

    await GET();

    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(prisma.chunk.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/documents", () => {
  it("rejects a request with no file", async () => {
    const response = await POST(new NextRequest("http://localhost/api/documents", { method: "POST", body: new FormData() }));
    expect(response.status).toBe(400);
    expect(prisma.document.create).not.toHaveBeenCalled();
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

  it("stores a text upload and its chunks", async () => {
    const file = new File(
      ["Atlas stores research notes. Retrieval finds the relevant passages. Overlap keeps context."],
      "notes.txt",
      { type: "text/plain" }
    );
    const response = await POST(uploadRequest(file));

    expect(response.status).toBe(201);
    expect(prisma.document.create).toHaveBeenCalledTimes(1);
    expect(prisma.chunk.create).toHaveBeenCalledTimes(1);
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
    expect(prisma.document.deleteMany).toHaveBeenCalledWith({ where: { id: "doc-1" } });
  });
});
