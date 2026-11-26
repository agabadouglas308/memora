import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cosine } from "@/lib/rag";
import { embedTexts, embeddingModelName, streamAnswer, usesOllama } from "@/lib/provider";
import { candidateIds, embeddingFor } from "@/lib/search-index";

export const runtime = "nodejs";

function parseCitations(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const messages = await prisma.message.findMany({ orderBy: { createdAt: "asc" }, take: 100 });
  return NextResponse.json({
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      citations: parseCitations(message.citations),
    })),
  });
}

export async function DELETE() {
  await prisma.message.deleteMany({});
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest) {
  const { question } = await request.json();
  if (!question || typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }

  const [queryEmbedding] = await embedTexts([question]);
  const chunks = await prisma.chunk.findMany({
    where: { model: embeddingModelName },
    include: { document: { select: { id: true, name: true } } },
  });

  const candidates = candidateIds(question, chunks);
  const ranked = chunks
    .filter((chunk) => usesOllama() || candidates.has(chunk.id))
    .map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      position: chunk.position,
      documentId: chunk.document.id,
      documentName: chunk.document.name,
      score: cosine(queryEmbedding, embeddingFor(chunk.id, chunk.embedding)),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const citations = ranked.map(({ id, documentId, documentName, position, text, score }) => ({
    id, documentId, documentName, position, text, score,
  }));

  const encoder = new TextEncoder();
  let answer = "";
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const token of streamAnswer(question, ranked)) {
          answer += token;
          controller.enqueue(encoder.encode(token));
        }
      } catch {
        const fallback = "I could not generate an answer. Please try again.";
        answer += fallback;
        controller.enqueue(encoder.encode(fallback));
      }

      controller.enqueue(encoder.encode(`\n\n__CITATIONS__${JSON.stringify(citations)}`));
      try {
        await prisma.message.create({ data: { role: "user", content: question, citations: "[]" } });
        await prisma.message.create({ data: { role: "assistant", content: answer, citations: JSON.stringify(citations) } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
