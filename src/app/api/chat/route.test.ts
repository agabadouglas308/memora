import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { embedText } from "@/lib/rag";
import { CITATION_MARKER } from "@/lib/protocol";

const prisma = vi.hoisted(() => ({
  chunk: { findMany: vi.fn() },
  message: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma }));

import { DELETE, GET, POST } from "./route";

function ask(question: string) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.message.create.mockResolvedValue({});
  prisma.message.findMany.mockResolvedValue([]);
  prisma.message.deleteMany.mockResolvedValue({ count: 0 });
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

  it("rejects a malformed JSON body", async () => {
    const response = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST",
      body: "not json",
    }));
    expect(response.status).toBe(400);
  });

  it("streams an answer followed by citations", async () => {
    const response = await POST(ask("What is Atlas?"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Atlas is a research platform");
    expect(body).toContain(CITATION_MARKER);
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
    expect(await response.text()).toContain("could not find relevant information");
  });
});

describe("chat history", () => {
  it("returns saved messages with parsed citations, oldest first", async () => {
    prisma.message.findMany.mockResolvedValue([
      { role: "assistant", content: "Atlas is a platform.", citations: '[{"id":"chunk-1"}]' },
      { role: "user", content: "What is Atlas?", citations: "[]" },
    ]);

    const response = await GET();
    const data = await response.json();

    expect(data.messages).toHaveLength(2);
    expect(data.messages[0].role).toBe("user");
    expect(data.messages[1].citations).toEqual([{ id: "chunk-1" }]);
    expect(prisma.message.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" }, take: 100 });
  });

  it("tolerates corrupted citation data", async () => {
    prisma.message.findMany.mockResolvedValue([
      { role: "assistant", content: "Answer", citations: "broken json" },
    ]);
    expect((await (await GET()).json()).messages[0].citations).toEqual([]);
  });

  it("clears the conversation", async () => {
    const response = await DELETE();
    expect(response.status).toBe(204);
    expect(prisma.message.deleteMany).toHaveBeenCalledOnce();
  });
});
