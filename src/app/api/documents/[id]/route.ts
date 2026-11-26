import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const result = await prisma.document.deleteMany({ where: { id: params.id } });
  if (result.count === 0) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
