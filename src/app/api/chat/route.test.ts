import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { embedText } from "@/lib/rag";

const prisma = vi.hoisted(() => ({
  chunk: { findMany: vi.fn() },
  message: { create: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma }));

import { POST } from "./route";

function ask(question: string) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.message.create.mockResolvedValue({});
  prisma.chunk.findMany.mockResolvedValue([
    {
      id: "chunk-1",
      text: "Atlas is a research platform that turns dense notes into traceable answers.",
      position: 0,
      embedding: JSON.stringify(
        embedText("Atlas is a research platform that turns dense notes into traceable answers.")
      ),
      document: { id: "doc-1", name: "Atlas research notes.md" },
    },
  ]);
});

describe("POST /api/chat", () => {
  it("rejects an empty question", async () => {
    const response = await POST(ask("   "));
    expect(response.status).toBe(400);
    expect(prisma.chunk.findMany).not.toHaveBeenCalled();
  });

  it("streams an answer followed by citations", async () => {
    const response = await POST(ask("What is Atlas?"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Atlas is a research platform");
    expect(body).toContain("__CITATIONS__");
    expect(body).toContain("Atlas research notes.md");
    expect(prisma.message.create).toHaveBeenCalledTimes(2);
  });

  it("ignores a corrupted embedding instead of throwing", async () => {
    prisma.chunk.findMany.mockResolvedValue([
      {
        id: "chunk-2",
        text: "Some unrelated document content.",
        position: 0,
        embedding: "not valid json",
        document: { id: "doc-2", name: "broken.md" },
      },
    ]);

    const response = await POST(ask("What is Atlas?"));
    expect(response.status).toBe(200);
    expect((await response.text())).toContain("could not find relevant information");
  });
});
