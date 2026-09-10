import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessBoard } from "@/lib/boardAccess";
import { sessionFromApiKey, unauthorized } from "@/lib/apiAuth";

/**
 * GET /api/v1/boards/:boardId/items
 *
 * Cells come back keyed by column name rather than column id: an integration
 * written against "Finish" keeps working when the board is rebuilt, and
 * nobody outside this app knows what cmt9tb06t0013qs2odcjnrzqa means.
 *
 * Trashed items are left out, exactly as they are everywhere else.
 */
export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const session = await sessionFromApiKey(request);
  if (!session) return unauthorized();

  const { boardId } = await params;
  if (!(await canAccessBoard(session, boardId))) {
    return NextResponse.json({ error: "找不到看板" }, { status: 404 });
  }

  const [columns, items] = await Promise.all([
    prisma.column.findMany({ where: { boardId }, select: { id: true, name: true } }),
    prisma.item.findMany({
      where: { boardId, deletedAt: null },
      select: {
        id: true,
        name: true,
        groupId: true,
        parentId: true,
        order: true,
        createdAt: true,
        baselineStart: true,
        baselineEnd: true,
        cellValues: { select: { columnId: true, value: true } },
      },
      orderBy: { order: "asc" },
    }),
  ]);
  const nameById = new Map(columns.map((c) => [c.id, c.name]));

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      groupId: item.groupId,
      parentId: item.parentId,
      order: item.order,
      createdAt: item.createdAt,
      baselineStart: item.baselineStart,
      baselineEnd: item.baselineEnd,
      cells: Object.fromEntries(
        item.cellValues.flatMap((cv) => {
          const name = nameById.get(cv.columnId);
          return name ? [[name, cv.value]] : [];
        })
      ),
    })),
  });
}
