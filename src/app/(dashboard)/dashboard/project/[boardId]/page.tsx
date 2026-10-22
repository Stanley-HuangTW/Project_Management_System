import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { boardWithDataArgs } from "@/types/board";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { applyVisibilityToBoards } from "@/lib/applyVisibility";
import { loadDmScopeSettings } from "@/lib/dmScopeServer";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { loadItemEventSummaries } from "@/lib/itemEventsServer";
import { computeLeaderOverview } from "@/lib/leaderOverview";
import { fullProjectScope, PROJECT_ROLE_LABELS, resolveProjectScope } from "@/lib/projectRoles";
import { ProjectDashboardView } from "@/components/dashboard/ProjectDashboardView";

/**
 * 專案儀表板(側邊欄「看板名稱-儀表板」):這個人在這個專案上有角色的話,看專案的逾期、本週完成、未來 7 天工作項,
 * 以及每個人的時程。Team Leader / PMD 看整個專案;各職能 DM 看自己組員(加自己)的項目。沒有角色的人進不來(管理者可以)。
 */
export default async function ProjectDashboardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const session = await requireSession();
  const { boardId } = await params;

  const [found, users, resources, holidayRows] = await Promise.all([
    prisma.board.findFirst({
      where: { AND: [{ id: boardId }, accessibleBoardWhere(session)] },
      ...boardWithDataArgs,
    }),
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.resource.findMany({ select: { id: true, name: true } }),
    listHolidays(),
  ]);
  if (!found) notFound();

  const own = resolveProjectScope(found.groups, session.userId);
  const scope = session.role === "ADMIN" ? { ...fullProjectScope(found.groups), roles: own?.roles ?? [] } : own;
  if (!scope) notFound();

  // 看得到哪些工作項照畫面一樣(私人項目、DM 的可見範圍都會擋)。
  const [board] = applyVisibilityToBoards([found], session, await loadDmScopeSettings());
  const eventSummaries = await loadItemEventSummaries([board.id], new Set(board.items.map((i) => i.id)));
  const completedAtByItem = Object.fromEntries(
    Object.entries(eventSummaries).flatMap(([id, s]) => (s.completedAt ? [[id, s.completedAt]] : []))
  );
  const nameOf = new Map<string, string>([...users, ...resources].map((u) => [u.id, u.name]));
  const [overview] = computeLeaderOverview([board], nameOf, toHolidaySet(holidayRows), completedAtByItem, () => scope);

  const coversAll = board.groups.every((g) => scope.groups.get(g.id) === "all");

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{board.name}-儀表板</h1>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {scope.roles.length > 0 && <>你是這個專案的 {scope.roles.map((r) => PROJECT_ROLE_LABELS[r]).join("、")}。</>}
          {coversAll
            ? "這裡是整個專案、所有人的工作項。"
            : "這裡是你負責的分組、以及你的組員(依你在各分組的角色)的工作項。"}
          逾期、本週完成、未來 7 天跟「我的儀表板」的「待辦事項到期清單」同一個算法。
        </p>
      </div>
      <ProjectDashboardView board={overview} />
    </div>
  );
}
