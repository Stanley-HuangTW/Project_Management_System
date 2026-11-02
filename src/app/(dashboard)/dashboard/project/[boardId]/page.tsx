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
import { OpenRisksCard } from "@/components/dashboard/OpenRisksCard";
import { loadOpenRiskRows } from "@/lib/dashboardRisksServer";
import { ProtoUsageSection } from "@/components/dashboard/ProtoUsageSection";
import { loadProtoUsage } from "@/lib/protoUsageServer";
import { computeWeekColumns } from "@/lib/workload";
import { getWorkloadThreshold } from "@/lib/actions/workloadThreshold";

/**
 * 專案儀表板(側邊欄「看板名稱-儀表板」):這個人在這個專案上有角色的話,看專案的逾期、本週完成、未來 7 天工作項,
 * 以及每個人的時程,再加上這個專案還沒結案的風險與議題。Team Leader / PMD 看整個專案;各職能 DM 看自己組員(加自己)的項目。
 * 沒有角色的人進不來(管理者可以)。
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
  // 風險登記冊本來就是看板成員都看得到:有專案角色的人看這個專案所有未結案的風險與議題。
  // 「與我有關」= 我與我範圍裡的組員負責的(DM 的組員);Team Leader / PMD 就是自己。
  const riskRows = await loadOpenRiskRows([{ id: board.id, name: board.name }]);
  const relatedIds = new Set([session.userId]);
  for (const groupScope of scope.groups.values()) if (groupScope !== "all") for (const id of groupScope) relatedIds.add(id);

  // 這個專案每一台有工作項在用的樣機,以及用它的工作項(樣機計畫 → 表格「使用樣機」欄選的)。
  const holidays = toHolidaySet(holidayRows);
  const weeks = computeWeekColumns([board], holidays);
  const [protoUsage, threshold] = await Promise.all([loadProtoUsage([board], weeks, holidays), getWorkloadThreshold()]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{board.name}-儀表板</h1>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {scope.roles.length > 0 && <>你是這個專案的 {scope.roles.map((r) => PROJECT_ROLE_LABELS[r]).join("、")}。</>}
          {coversAll
            ? "這裡是整個專案、所有人的工作項。"
            : "這裡是你負責的分組、以及你的組員(依你在各分組的角色)的工作項。"}
          逾期、本週完成、未來 7 天跟「我的儀表板」的「待辦事項到期清單」同一個算法;風險與議題是這個專案所有還沒結案的。
        </p>
      </div>
      <OpenRisksCard rows={riskRows} relatedUserIds={[...relatedIds]} defaultAll />
      <ProjectDashboardView board={overview} />
      {protoUsage.machines.length > 0 && (
        <ProtoUsageSection
          title={`樣機使用時程(${protoUsage.machines.length} 台使用中)`}
          machines={protoUsage.machines}
          idle={protoUsage.idle}
          tasksByMachine={protoUsage.tasksByMachine}
          weeks={weeks}
          weeklyLoadByMachine={protoUsage.weeklyLoadByMachine}
          colors={threshold}
          showBoardName={false}
        />
      )}
    </div>
  );
}
