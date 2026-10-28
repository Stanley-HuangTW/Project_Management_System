import { deputyTeamIdsOf } from "@/lib/orgChartServer";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canAccessBoard } from "@/lib/boardAccess";
import { boardWithDataArgs, type UserOption } from "@/types/board";
import { BoardView } from "@/components/board/BoardView";
import { listHolidays } from "@/lib/holidays";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { applyVisibility } from "@/lib/applyVisibility";
import { loadDmScopeSettings } from "@/lib/dmScopeServer";
import { loadItemEventSummaries } from "@/lib/itemEventsServer";
import { loadProtoUnitsData } from "@/lib/protoUnitsServer";
import { externalPredecessors } from "@/lib/externalPredecessors";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ highlight?: string; highlightAt?: string; highlightTab?: string; openAction?: string; view?: string }>;
}) {
  const { boardId } = await params;
  const { highlight, highlightAt, highlightTab, openAction, view } = await searchParams;

  const [session, board, users, resources, holidays] = await Promise.all([
    requireSession(),
    prisma.board.findUnique({
      where: { id: boardId },
      ...boardWithDataArgs,
    }),
    prisma.user.findMany({
      select: { id: true, name: true, supervisorId: true, avatarUrl: true, discipline: true },
      orderBy: { name: "asc" },
    }),
    prisma.resource.findMany({ orderBy: { order: "asc" } }),
    listHolidays(),
  ]);

  if (!board) notFound();
  if (!(await canAccessBoard(session, boardId))) notFound();

  // 已經被指到的那幾個外部前置,連日期一起 —— 甘特圖要為它們畫一列,
  // 藍色虛線才有地方接。
  const externalPreds = await externalPredecessors(boardId);
  // 連了 MantisBT 的看板多一個「議題」分頁。
  const hasMantis = !!(await prisma.mantisConnection.findUnique({ where: { boardId }, select: { id: true } }));

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
  const visibleBoard = applyVisibility(board, session, await loadDmScopeSettings());
  // 表格最右邊三欄(進行中時間、完成時間、更新記錄)的資料——只給看得到的項目。
  const eventSummaries = await loadItemEventSummaries(
    [boardId],
    new Set(visibleBoard.items.map((i) => i.id))
  );

  // 「使用樣機」欄:這個看板可選的樣機,以及每個工作項用到哪幾台(只給看得到的項目)。
  const protoUnits = await loadProtoUnitsData(boardId, new Set(visibleBoard.items.map((i) => i.id)));

  return (
    <BoardView
      board={visibleBoard}
      users={assignees}
      userRole={session.role}
      currentUserId={session.userId}
      highlightItemId={highlight ?? null}
      highlightNonce={highlightAt ?? null}
      highlightTab={highlightTab ?? null}
      initialView={view ?? null}
      openAction={openAction ?? null}
      holidays={holidays}
      externalPreds={externalPreds}
      hasMantis={hasMantis}
      eventSummaries={eventSummaries}
      protoUnits={protoUnits}
      deputyTeam={await deputyTeamIdsOf(session.userId)}
      ownerDefaultPct={(await getSystemSettings()).ownerDefaultAllocationPct}
    />
  );
}
