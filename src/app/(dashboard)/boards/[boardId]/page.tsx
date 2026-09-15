import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canAccessBoard } from "@/lib/boardAccess";
import { boardWithDataArgs, type UserOption } from "@/types/board";
import { BoardView } from "@/components/board/BoardView";
import { listHolidays } from "@/lib/holidays";
import { applyVisibility } from "@/lib/applyVisibility";
import { crossBoardPredOptions } from "@/lib/crossBoardPred";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ highlight?: string }>;
}) {
  const { boardId } = await params;
  const { highlight } = await searchParams;

  const [session, board, users, resources, holidays] = await Promise.all([
    requireSession(),
    prisma.board.findUnique({
      where: { id: boardId },
      ...boardWithDataArgs,
    }),
    prisma.user.findMany({
      select: { id: true, name: true, supervisorId: true, avatarUrl: true },
      orderBy: { name: "asc" },
    }),
    prisma.resource.findMany({ orderBy: { order: "asc" } }),
    listHolidays(),
  ]);

  if (!board) notFound();
  if (!(await canAccessBoard(session, boardId))) notFound();

  // 同群組其他看板的工作項,給 Pred 選單 —— 排程引擎本來就吃跨看板的前置,
  // 缺的一直是選得到它們的地方。
  const crossBoardPreds = await crossBoardPredOptions(boardId);

  // Resources (tools, external vendors) can be set as an item's 負責人
  // alongside real Users, so they're merged into the same assignee list —
  // but only here for board views, not in dashboards/workload/notifications.
  const assignees: UserOption[] = [
    ...users,
    ...resources.map((r) => ({
      id: r.id,
      name: r.category ? `${r.name} (${r.category})` : r.name,
      supervisorId: null,
      avatarUrl: null,
      isResource: true,
    })),
  ];

  // Private groups and items the caller is not on never reach the client.
  const visibleBoard = applyVisibility(board, session);

  return (
    <BoardView
      board={visibleBoard}
      users={assignees}
      userRole={session.role}
      currentUserId={session.userId}
      highlightItemId={highlight ?? null}
      holidays={holidays}
      crossBoardPreds={crossBoardPreds}
    />
  );
}
