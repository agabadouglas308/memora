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
import { embedTexts, embeddingModelName } from "@/lib/provider";
import { DEMO_DOCUMENT } from "@/lib/demo-document";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);
function unauthorized() {
  return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
}

async function claimSeed(key: string) {
  try {
    await prisma.appMeta.create({ data: { key, value: "true" } });
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return false;
    throw error;
  }
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
  const vectors = chunks.length ? await embedTexts(chunks) : [];
  await prisma.$transaction([
    prisma.document.create({ data: { id, ...data } }),
    ...chunks.map((chunk, position) =>
      prisma.chunk.create({
        data: {
          documentId: id,
          text: chunk,
          position,
          embedding: JSON.stringify(vectors[position]),
          model: embeddingModelName,
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
  const activeChunkCount = await prisma.chunk.count({
    where: { model: embeddingModelName, document: { userId: user.id } },
  });
  const warning = documents.length > 0 && activeChunkCount === 0
    ? `No chunks match the active embedding model (${embeddingModelName}). Re-upload your documents.`
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
}
