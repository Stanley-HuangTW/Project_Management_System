import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { sessionFromApiKey, unauthorized } from "@/lib/apiAuth";

/** GET /api/v1/boards — the boards this key's owner can open. */
export async function GET(request: Request) {
  const session = await sessionFromApiKey(request);
  if (!session) return unauthorized();

  const boards = await prisma.board.findMany({
    where: accessibleBoardWhere(session),
    select: {
      id: true,
      name: true,
      createdAt: true,
      groups: { select: { id: true, name: true }, orderBy: { order: "asc" } },
      columns: { select: { id: true, name: true, type: true }, orderBy: { order: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ boards });
}
