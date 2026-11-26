import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { answerFromContext, cosine, embedText, parseEmbedding } from "@/lib/rag";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { question } = await request.json();
  if (!question || typeof question !== "string" || !question.trim()) {
    return new Response(JSON.stringify({ error: "Question is required" }), { status: 400 });
  }

  const queryEmbedding = embedText(question);
  const chunks = await prisma.chunk.findMany({
    include: { document: { select: { id: true, name: true } } },
  });

  const ranked = chunks
    .map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      position: chunk.position,
      documentId: chunk.document.id,
      documentName: chunk.document.name,
      score: cosine(queryEmbedding, parseEmbedding(chunk.embedding)),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const answer = answerFromContext(question, ranked);
  await prisma.message.create({ data: { role: "user", content: question, citations: "[]" } });
  await prisma.message.create({
    data: { role: "assistant", content: answer, citations: JSON.stringify(ranked.map(({ id, documentId, documentName, position, text, score }) => ({ id, documentId, documentName, position, text, score }))) },
  });

  const encoder = new TextEncoder();
  const words = answer.split(/(\s+)/);
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index >= words.length) {
        controller.enqueue(encoder.encode(`\n\n__CITATIONS__${JSON.stringify(ranked.map(({ id, documentId, documentName, position, text, score }) => ({ id, documentId, documentName, position, text, score })))}`));
        controller.close();
        return;
      }
      const part = words[index++];
      controller.enqueue(encoder.encode(part));
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
