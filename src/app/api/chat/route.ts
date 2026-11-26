import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { embedTexts, embeddingModelName, streamAnswer, usesOllama } from "@/lib/provider";
import { rankChunks } from "@/lib/retrieval";
import { CITATION_MARKER } from "@/lib/protocol";

export const runtime = "nodejs";

function parseCitations(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function unauthorized() {
  return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return unauthorized();

  const messages = await prisma.message.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    messages: messages.reverse().map((message) => ({
      role: message.role,
      content: message.content,
      citations: parseCitations(message.citations),
    })),
  });
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return unauthorized();

  await prisma.message.deleteMany({ where: { userId: user.id } });
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const question = (body as { question?: unknown } | null)?.question;
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }

  const user = await getCurrentUser(request);
  if (!user) return unauthorized();

  const [queryEmbedding] = await embedTexts([question]);
  const chunks = await prisma.chunk.findMany({
    where: { model: embeddingModelName, document: { userId: user.id } },
    include: { document: { select: { id: true, name: true } } },
  });

  const ranked = rankChunks(
    question,
    chunks.map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      position: chunk.position,
      embedding: chunk.embedding,
      documentId: chunk.document.id,
      documentName: chunk.document.name,
    })),
    queryEmbedding,
    { useCandidates: !usesOllama() }
  );

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

      controller.enqueue(encoder.encode(`\n\n${CITATION_MARKER}${JSON.stringify(citations)}`));
      try {
        await prisma.message.create({ data: { role: "user", content: question, citations: "[]", userId: user.id } });
        await prisma.message.create({ data: { role: "assistant", content: answer, citations: JSON.stringify(citations), userId: user.id } });
      } catch {
        // A failed history write must not break the answer stream.
      }
      controller.close();
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
