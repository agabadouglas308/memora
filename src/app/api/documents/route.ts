import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
import { chunkText, embedText } from "@/lib/rag";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

async function extractPdf(buffer: Buffer) {
  const directory = await mkdtemp(path.join(tmpdir(), "memora-pdf-"));
  const pdfPath = path.join(directory, "document.pdf");
  const textPath = path.join(directory, "document.txt");
  try {
    await writeFile(pdfPath, buffer);
    await execFileAsync("pdftotext", ["-layout", pdfPath, textPath], { timeout: 30_000 });
    const text = await readFile(textPath, "utf8");
    return text;
  } finally {
    await unlink(pdfPath).catch(() => undefined);
    await unlink(textPath).catch(() => undefined);
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

const DEMO_DOCUMENT = `# Atlas Research Notes

## Executive overview
Atlas is a fictional research platform built to help teams turn dense internal knowledge into fast, traceable answers. The platform combines document ingestion, semantic retrieval, source-grounded responses, and clear citations.

## Architecture
The ingestion pipeline extracts text from uploaded PDFs or Markdown documents, divides it into overlapping chunks, creates embeddings for each chunk, and stores the chunks alongside their source metadata.

At query time, the application embeds the question and compares it against the document chunks using cosine similarity. The most relevant passages are sent to the answer generator, which must ground its response in those passages.

## Why overlap matters
Chunk overlap preserves context that would otherwise be lost when a paragraph or sentence crosses a chunk boundary. A 10–15% overlap is a useful starting point for long-form technical documents.

## Evaluation
The retrieval layer should be evaluated with a labeled set of questions and source passages. Useful metrics include recall@k, precision@k, and whether a generated answer is grounded in the retrieved evidence.

## Security
Every document and query result should be scoped to the owning workspace. Production deployments should add authentication, signed upload URLs, row-level database policies, and prompt-injection safeguards.`;

export async function GET() {
  const count = await prisma.document.count();
  if (count === 0) {
    const document = await prisma.document.create({
      data: { name: "Atlas research notes.md", type: "text/markdown", size: DEMO_DOCUMENT.length, text: DEMO_DOCUMENT },
    });
    await Promise.all(chunkText(DEMO_DOCUMENT).map((text, position) =>
      prisma.chunk.create({
        data: { documentId: document.id, text, position, embedding: JSON.stringify(embedText(text)) },
      })
    ));
  } else {
    const documentsWithoutChunks = await prisma.document.findMany({
      where: { chunks: { none: {} } },
      select: { id: true, text: true },
    });
    await Promise.all(documentsWithoutChunks.flatMap((document) =>
      chunkText(document.text).map((text, position) =>
        prisma.chunk.create({
          data: { documentId: document.id, text, position, embedding: JSON.stringify(embedText(text)) },
        })
      )
    ));
  }

  const documents = await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { chunks: true } } },
  });
  return NextResponse.json({ documents });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const allowedTypes = ["application/pdf", "text/plain", "text/markdown"];
  const hasAllowedExtension = /\.(pdf|txt|md|markdown)$/i.test(file.name);
  if (!allowedTypes.includes(file.type) && !hasAllowedExtension) {
    return NextResponse.json({ error: "Upload a PDF, Markdown, or TXT file" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Maximum file size is 10 MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let text = "";
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    text = await extractPdf(buffer);
  } else {
    text = buffer.toString("utf8");
  }
  text = text.replace(/\0/g, "").trim();
  if (text.length < 20) return NextResponse.json({ error: "The file contains no readable text" }, { status: 422 });

  const document = await prisma.document.create({
    data: { name: file.name, type: file.type || "text/plain", size: file.size, text },
  });
  const chunks = chunkText(text);
  await Promise.all(chunks.map((chunk, position) =>
    prisma.chunk.create({
      data: { documentId: document.id, text: chunk, position, embedding: JSON.stringify(embedText(chunk)) },
    })
  ));

  return NextResponse.json({
    document: { id: document.id, name: document.name, type: document.type, size: document.size, chunkCount: chunks.length },
  }, { status: 201 });
}
