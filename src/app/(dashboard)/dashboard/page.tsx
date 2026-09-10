import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { boardWithDataArgs } from "@/types/board";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { canManageStructure } from "@/lib/permissions";
import {
  computeTeamWorkload,
  computeMemberItemWorkload,
  computeBoardProgressOverview,
  computeOverdueUpcoming,
  computePersonalItems,
  type WorkloadPeriod,
  type MemberItemWorkloadEntry,
} from "@/lib/dashboard";
import { TeamWorkloadCard } from "@/components/dashboard/TeamWorkloadCard";
import { WorkloadDetailSection } from "@/components/dashboard/WorkloadDetailSection";
import { PersonalItemsList } from "@/components/dashboard/PersonalItemsList";
import { OverAllocationCard } from "@/components/dashboard/OverAllocationCard";
import { computeCriticalPath } from "@/lib/criticalPath";
import { getWorkloadThreshold } from "@/lib/actions/workloadThreshold";
import {
  computeMemberTaskBreakdown,
  computeWeekColumns,
  computeMemberWeeklyLoad,
  type MemberTask,
} from "@/lib/workload";
import { buildSupervisorParentTree, buildFullParentTree } from "@/lib/parentTaskTree";
import { listHolidays, toHolidaySet } from "@/lib/holidays";

function formatDate(date: Date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const session = await requireSession();
  const { board: boardFilter } = await searchParams;

  const [allBoards, users, managedResources, holidayRows] = await Promise.all([
    prisma.board.findMany({
      where: accessibleBoardWhere(session),
      ...boardWithDataArgs,
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, name: true, supervisorId: true, avatarUrl: true },
      orderBy: { name: "asc" },
    }),
    prisma.resource.findMany({
      where: { managerId: { not: null } },
      select: { id: true, name: true, managerId: true },
    }),
    listHolidays(),
  ]);
  const holidays = toHolidaySet(holidayRows);

  const boards = boardFilter ? allBoards.filter((b) => b.id === boardFilter) : allBoards;

  // A resource (tool/vendor) can be an item's 負責人 like a real user, but has
  // no login of its own — its 負責窗口 is the real user who tracks its work,
  // so items assigned to the resource should show up on that person's
  // dashboard as if they owned them directly.
  const resourceIdsByManager = new Map<string, string[]>();
  for (const r of managedResources) {
    const list = resourceIdsByManager.get(r.managerId!) ?? [];
    list.push(r.id);
    resourceIdsByManager.set(r.managerId!, list);
  }
  const userById = new Map(users.map((u) => [u.id, u.name]));
  for (const r of managedResources) userById.set(r.id, r.name);
  function withManagedResourceIds(userIds: string[]): string[] {
    return userIds.flatMap((id) => [id, ...(resourceIdsByManager.get(id) ?? [])]);
  }
  const isSupervisor = session.role === "SUPERVISOR";
  const isAdmin = session.role === "ADMIN";
  const teamMembers = isSupervisor
    ? users.filter((u) => u.supervisorId === session.userId)
    : [];
  // Admins see the whole org's workload; supervisors see their own plus
  // their team's (they do real work too, not just oversight); plain members
  // only see their own — not everyone else's.
  const currentUser = users.find((u) => u.id === session.userId);
  const workloadScope = isSupervisor
    ? currentUser
      ? [currentUser, ...teamMembers]
      : teamMembers
    : isAdmin
      ? users
      : users.filter((u) => u.id === session.userId);
  // Who a supervisor is allowed to hand new subtasks to from the dashboard —
  // their own team only, not the whole org.
  const assignableUsers = isSupervisor ? teamMembers : isAdmin ? users : [];

  const teamWorkloadDay = computeTeamWorkload(boards, workloadScope, "day", holidays);
  const teamWorkloadWeek = computeTeamWorkload(boards, workloadScope, "week", holidays);
  const teamWorkloadMonth = computeTeamWorkload(boards, workloadScope, "month", holidays);
  const boardProgress = computeBoardProgressOverview(boards);
  const { overdue, upcoming, completed } = computeOverdueUpcoming(
    boards,
    isSupervisor
      ? withManagedResourceIds([session.userId, ...teamMembers.map((m) => m.id)])
      : isAdmin
        ? undefined
        : withManagedResourceIds([session.userId]),
    holidays
  );
  const personalItems = computePersonalItems(boards, [session.userId], userById, holidays);
  const myResourceIds = resourceIdsByManager.get(session.userId) ?? [];
  const myResourceItems = computePersonalItems(boards, myResourceIds, userById, holidays);
  const teamItems = isSupervisor
    ? computePersonalItems(boards, withManagedResourceIds(teamMembers.map((m) => m.id)), userById, holidays)
    : [];

  const workloadThreshold = await getWorkloadThreshold();
  const workloadScopeIds = workloadScope.map((u) => u.id);
  const memberTasksMap = computeMemberTaskBreakdown(boards, workloadScopeIds, holidays);
  // Admins aren't limited to delegating their own work — they can split a
  // subtask off any task in the full hierarchy. Supervisors get a tree of
  // the ancestor paths of tasks assigned to them or their team, so they can
  // pick any level of their team's work as the new subtask's parent — a
  // supervisor with no assignments of their own still needs to be able to
  // add work under a team member's existing task.
  const parentTaskTree =
    session.role === "ADMIN"
      ? buildFullParentTree(allBoards, holidays)
      : buildSupervisorParentTree(boards, [session.userId, ...teamMembers.map((m) => m.id)], holidays);
  const weekColumns = computeWeekColumns(boards, holidays);
  const weeklyLoadMap = computeMemberWeeklyLoad(boards, workloadScopeIds, weekColumns, holidays);

  const tasksByUser: Record<string, MemberTask[]> = {};
  const weeklyLoadByUser: Record<string, number[]> = {};
  for (const id of workloadScopeIds) {
    tasksByUser[id] = memberTasksMap.get(id) ?? [];
    weeklyLoadByUser[id] = weeklyLoadMap.get(id) ?? [];
  }

  // Float per item, so 過度配置 can say which of someone's stacked tasks
  // could actually slip. Group-scoped, like every other Pred computation.
  const floatByItemId: Record<string, number> = {};
  for (const board of boards) {
    const linkColumn = board.columns.find((c) => c.id === board.linkColumnId);
    const byGroup = new Map<string, typeof board.items>();
    for (const item of board.items) {
      byGroup.set(item.groupId, [...(byGroup.get(item.groupId) ?? []), item]);
    }
    for (const groupItems of byGroup.values()) {
      const floats = computeCriticalPath(
        groupItems,
        {
          predColumnId: board.predColumnId,
          linkColumnId: board.linkColumnId,
          linkColumnOptions: linkColumn?.options,
          lagColumnId: board.lagColumnId,
          startColumnId: board.ganttStartColumnId,
          durationColumnId: board.ganttDurationColumnId,
          durationMode: board.ganttDurationMode,
        },
        holidays
      );
      for (const [id, value] of floats) floatByItemId[id] = value.totalFloat;
    }
  }

  const memberItemWorkload: Record<string, Record<WorkloadPeriod, MemberItemWorkloadEntry[]>> = {};
  for (const id of workloadScopeIds) {
    memberItemWorkload[id] = {
      day: computeMemberItemWorkload(boards, id, "day", holidays),
      week: computeMemberItemWorkload(boards, id, "week", holidays),
      month: computeMemberItemWorkload(boards, id, "month", holidays),
    };
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">儀表板</h1>
        <form action="/dashboard" method="GET" className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500 dark:text-neutral-400">看板篩選</span>
          <select
            name="board"
            defaultValue={boardFilter ?? ""}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
          >
            <option value="">全部看板</option>
            {allBoards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-1.5 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            套用
          </button>
        </form>
      </div>

      <TeamWorkloadCard
        title={isSupervisor ? "我的團隊工作量總覽" : isAdmin ? "團隊工作量總覽" : "我的工作量總覽"}
        day={teamWorkloadDay}
        week={teamWorkloadWeek}
        month={teamWorkloadMonth}
        memberItemWorkload={memberItemWorkload}
      />

      <OverAllocationCard
        users={workloadScope.map((u) => ({ id: u.id, name: u.name }))}
        tasksByUser={tasksByUser}
        floatByItemId={floatByItemId}
        thresholdPct={workloadThreshold.yellowMax}
      />

      <WorkloadDetailSection
        users={workloadScope.map((u) => ({ id: u.id, name: u.name }))}
        tasksByUser={tasksByUser}
        weeks={weekColumns}
        weeklyLoadByUser={weeklyLoadByUser}
        threshold={workloadThreshold}
        canCreateSubtask={canManageStructure(session.role)}
        parentTaskTree={parentTaskTree}
        allUsers={users}
        currentUserId={session.userId}
        userRole={session.role}
      />

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-100">看板進度總覽</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {boardProgress.map((b) => (
            <Link
              key={b.boardId}
              href={`/boards/${b.boardId}`}
              className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 hover:border-blue-300"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{b.boardName}</span>
                <span className="text-xs text-neutral-400 dark:text-neutral-500">{b.itemCount} 項目</span>
              </div>
              {b.avgProgress !== null && (
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${Math.round(b.avgProgress * 100)}%` }}
                  />
                </div>
              )}
              {b.statusBreakdown.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {b.statusBreakdown
                    .filter((s) => s.count > 0)
                    .map((s) => (
                      <span
                        key={s.option.id}
                        className="rounded-full px-2 py-0.5 text-xs text-white"
                        style={{ backgroundColor: s.option.color }}
                      >
                        {s.option.label} {s.count}
                      </span>
                    ))}
                </div>
              )}
            </Link>
          ))}
          {boardProgress.length === 0 && (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">尚無看板</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-100">逾期 / 即將到期項目</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
            <p className="mb-2 text-xs font-medium text-red-600">逾期({overdue.length})</p>
            {overdue.length === 0 ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">沒有逾期項目</p>
            ) : (
              <ul className="space-y-1.5">
                {overdue.map((e) => (
                  <li key={`${e.boardId}-${e.itemId}`} className="flex items-center justify-between text-sm">
                    <Link
                      href={`/boards/${e.boardId}?highlight=${e.itemId}`}
                      className="truncate text-neutral-700 dark:text-neutral-100 hover:text-blue-600"
                    >
                      {e.itemName}
                    </Link>
                    <span className="shrink-0 text-xs text-red-600">{formatDate(e.end)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
            <p className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">即將到期,7 天內({upcoming.length})</p>
            {upcoming.length === 0 ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">7 天內沒有到期項目</p>
            ) : (
              <ul className="space-y-1.5">
                {upcoming.map((e) => (
                  <li key={`${e.boardId}-${e.itemId}`} className="flex items-center justify-between text-sm">
                    <Link
                      href={`/boards/${e.boardId}?highlight=${e.itemId}`}
                      className="truncate text-neutral-700 dark:text-neutral-100 hover:text-blue-600"
                    >
                      {e.itemName}
                    </Link>
                    <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{formatDate(e.end)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
            <p className="mb-2 text-xs font-medium text-green-600">已完成項目({completed.length})</p>
            {completed.length === 0 ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">沒有已完成項目</p>
            ) : (
              <ul className="space-y-1.5">
                {completed.map((e) => (
                  <li key={`${e.boardId}-${e.itemId}`} className="flex items-center justify-between text-sm">
                    <Link
                      href={`/boards/${e.boardId}?highlight=${e.itemId}`}
                      className="truncate text-neutral-700 dark:text-neutral-100 hover:text-blue-600"
                    >
                      {e.itemName}
                    </Link>
                    <span className="shrink-0 text-xs text-green-600">{formatDate(e.end)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {isSupervisor && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-100">
            團隊項目({teamItems.length})
          </h2>
          <PersonalItemsList
            items={teamItems}
            showAssignees
            userRole={session.role}
            currentUserId={session.userId}
            users={users}
            assignableUsers={assignableUsers}
            emptyText="你的團隊目前沒有指派中的項目"
          />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-100">
          我的項目({personalItems.length})
        </h2>
        <PersonalItemsList
          items={personalItems}
          showAssignees={false}
          userRole={session.role}
          currentUserId={session.userId}
          users={users}
          assignableUsers={assignableUsers}
          emptyText="目前沒有指派給你的項目"
        />
      </section>

      {myResourceIds.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-100">
            我的團隊項目({myResourceItems.length})
          </h2>
          <PersonalItemsList
            items={myResourceItems}
            showAssignees
            userRole={session.role}
            currentUserId={session.userId}
            users={users}
            assignableUsers={assignableUsers}
            emptyText="你負責窗口的資源目前沒有指派中的項目"
          />
        </section>
      )}
    </div>
  );
}
