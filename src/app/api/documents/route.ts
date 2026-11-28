import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { chunkText } from "@/lib/rag";
import { embedWithFallback } from "@/lib/provider";
import { DEMO_DOCUMENT } from "@/lib/demo-document";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);
function unauthorized() {
  return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
}

async function claimSeed(key: string) {
  const changes = await prisma.$executeRaw`INSERT OR IGNORE INTO AppMeta (key, value) VALUES (${key}, ${"true"})`;
  return changes === 1;
}

async function extractPdf(buffer: Buffer) {
  const directory = await mkdtemp(path.join(tmpdir(), "memora-pdf-"));
  const pdfPath = path.join(directory, "document.pdf");
  const textPath = path.join(directory, "document.txt");
  try {
    await writeFile(pdfPath, buffer);
    await execFileAsync("pdftotext", ["-layout", pdfPath, textPath], { timeout: 30_000 });
    return await readFile(textPath, "utf8");
  } finally {
    await unlink(pdfPath).catch(() => undefined);
    await unlink(textPath).catch(() => undefined);
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function createDocumentWithChunks(data: { name: string; type: string; size: number; text: string; userId: string }) {
  const id = randomUUID();
  const chunks = chunkText(data.text);
  const embedded = chunks.length
    ? await embedWithFallback(chunks)
    : { vectors: [], model: "hash-384-v2" };
  await prisma.$transaction([
    prisma.document.create({ data: { id, ...data } }),
    ...chunks.map((chunk, position) =>
      prisma.chunk.create({
        data: {
          documentId: id,
          text: chunk,
          position,
          embedding: JSON.stringify(embedded.vectors[position]),
          model: embedded.model,
        },
      })
    ),
  ]);
  return { id, chunkCount: chunks.length };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return unauthorized();

  const claimed = await claimSeed(`demoSeeded:${user.id}`);
  const count = await prisma.document.count({ where: { userId: user.id } });
  if (count === 0 && claimed) {
    await createDocumentWithChunks({
      name: "Atlas research notes.md",
      type: "text/markdown",
      size: DEMO_DOCUMENT.length,
      text: DEMO_DOCUMENT,
      userId: user.id,
    });
  }

  const documents = await prisma.document.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { chunks: true } } },
  });
  const chunkCount = await prisma.chunk.count({ where: { document: { userId: user.id } } });
  const warning = documents.length > 0 && chunkCount === 0
    ? "Your documents have no indexed chunks. Re-upload them to enable search."
    : null;

  return NextResponse.json({ documents, warning });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return unauthorized();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload" }, { status: 400 });
  }

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
  let text: string;
  try {
    text = /\.pdf$/i.test(file.name) || file.type === "application/pdf"
      ? await extractPdf(buffer)
      : buffer.toString("utf8");
  } catch {
    return NextResponse.json({ error: "Could not extract text from that PDF" }, { status: 422 });
  }
  text = text.replace(/\0/g, "").trim();
  if (text.length < 20) return NextResponse.json({ error: "The file contains no readable text" }, { status: 422 });

  try {
    const { id, chunkCount } = await createDocumentWithChunks({
      name: file.name,
      type: file.type || "text/plain",
      size: file.size,
      text,
      userId: user.id,
    });
    return NextResponse.json({
      document: { id, name: file.name, type: file.type || "text/plain", size: file.size, chunkCount },
    }, { status: 201 });
  } catch (error) {
    console.error("Document ingestion failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Ingestion is temporarily unavailable." }, { status: 502 });
  }
}
