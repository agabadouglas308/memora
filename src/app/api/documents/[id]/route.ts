import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const result = await prisma.document.deleteMany({ where: { id: params.id, userId: user.id } });
  if (result.count === 0) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
