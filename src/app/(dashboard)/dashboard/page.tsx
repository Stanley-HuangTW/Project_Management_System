import Link from "next/link";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { boardWithDataArgs } from "@/types/board";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { DueListsSection } from "@/components/dashboard/DueListsSection";
import { TodoDeadlinesSection } from "@/components/dashboard/TodoDeadlinesSection";
import { taipeiClock, todoDeadlineEntries } from "@/lib/todoDeadline";
import { subordinateIds } from "@/lib/orgChart";
import { canManageStructure } from "@/lib/permissions";
import {
  computeTeamWorkload,
  computeMemberItemWorkload,
  computeBoardProgressOverview,
  computeDashboardDueLists,
  computePersonalItems,
  type WorkloadPeriod,
  type MemberItemWorkloadEntry,
} from "@/lib/dashboard";
import { TeamWorkloadCard } from "@/components/dashboard/TeamWorkloadCard";
import { WorkloadDetailSection } from "@/components/dashboard/WorkloadDetailSection";
import { PersonalItemsList } from "@/components/dashboard/PersonalItemsList";
import { OverAllocationCard } from "@/components/dashboard/OverAllocationCard";
import { BudgetAlertCard } from "@/components/dashboard/BudgetAlertCard";
import { budgetAlerts } from "@/lib/budgetAlerts";
import { computeCriticalPath } from "@/lib/criticalPath";
import { getWorkloadThreshold } from "@/lib/actions/workloadThreshold";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import {
  computeMemberTaskBreakdown,
  computeWeekColumns,
  computeMemberWeeklyLoad,
  type MemberTask,
} from "@/lib/workload";
import { buildSupervisorParentTree, buildFullParentTree } from "@/lib/parentTaskTree";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { applyVisibilityToBoards } from "@/lib/applyVisibility";
import { loadDmScopeSettings } from "@/lib/dmScopeServer";
import { loadItemEventSummaries } from "@/lib/itemEventsServer";
import { leaveDaysByUser } from "@/lib/actions/leave";
import { DashboardBoardFilter } from "@/components/dashboard/DashboardBoardFilter";
import { OpenRisksCard } from "@/components/dashboard/OpenRisksCard";
import { loadOpenRiskRows } from "@/lib/dashboardRisksServer";
import {
  DASHBOARD_BOARD_COOKIE,
  decodeBoardCookie,
  parseBoardParam,
  resolveBoardFilter,
} from "@/lib/dashboardBoardFilter";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string | string[] }>;
}) {
  const session = await requireSession();
  const { board: boardParam } = await searchParams;
  const savedBoardIds = decodeBoardCookie(session.userId, (await cookies()).get(DASHBOARD_BOARD_COOKIE)?.value);

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

  // Everything below counts, colours and lists items; none of it may count
  // an item this person is not allowed to see.
  const visibleBoards = applyVisibilityToBoards(allBoards, session, await loadDmScopeSettings());
  // 看板篩選可以複選,而且記住上次選的(網址有 ?board= 時以網址為準)。沒選 = 全部看板。
  const filterBoardIds = resolveBoardFilter({
    urlIds: parseBoardParam(boardParam),
    savedIds: savedBoardIds,
    accessibleIds: allBoards.map((b) => b.id),
  });
  const boards = filterBoardIds.length ? visibleBoards.filter((b) => filterBoardIds.includes(b.id)) : visibleBoards;

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
  const below = subordinateIds(users, session.userId);
  const teamMembers = isSupervisor ? users.filter((u) => below.has(u.id)) : [];
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

  const { ownerDefaultAllocationPct } = await getSystemSettings();
  const teamWorkloadDay = computeTeamWorkload(boards, workloadScope, "day", holidays, ownerDefaultAllocationPct);
  const teamWorkloadWeek = computeTeamWorkload(boards, workloadScope, "week", holidays, ownerDefaultAllocationPct);
  const teamWorkloadMonth = computeTeamWorkload(boards, workloadScope, "month", holidays, ownerDefaultAllocationPct);
  const boardProgress = computeBoardProgressOverview(boards);
  // 本週完成:以實際切成完成的時間為準(只問看得到的項目)。
  const eventSummaries = await loadItemEventSummaries(
    boards.map((b) => b.id),
    new Set(boards.flatMap((b) => b.items.map((i) => i.id)))
  );
  const completedAtByItem = Object.fromEntries(
    Object.entries(eventSummaries).flatMap(([id, s]) => (s.completedAt ? [[id, s.completedAt]] : []))
  );
  const { overdue, completedThisWeek, upcoming7, upcoming30 } = computeDashboardDueLists(
    boards,
    isSupervisor
      ? withManagedResourceIds([session.userId, ...teamMembers.map((m) => m.id)])
      : isAdmin
        ? undefined
        : withManagedResourceIds([session.userId]),
    holidays,
    completedAtByItem
  );
  // 工作項目底下、有設期限而且還沒完成的待辦事項。範圍跟上面的到期清單一樣:自己、(主管)加團隊、(管理者)全部。
  const visibleItemIds = boards.flatMap((b) => b.items.map((i) => i.id));
  const todoRows = visibleItemIds.length
    ? await prisma.todoItem.findMany({
        where: { done: false, dueDate: { not: null }, itemId: { in: visibleItemIds } },
        select: { id: true, itemId: true, text: true, dueDate: true, done: true, createdById: true },
      })
    : [];
  const todoDeadlines = todoDeadlineEntries(
    boards,
    todoRows,
    isSupervisor
      ? withManagedResourceIds([session.userId, ...teamMembers.map((m) => m.id)])
      : isAdmin
        ? undefined
        : withManagedResourceIds([session.userId])
  );
  const personalItems = computePersonalItems(boards, [session.userId], userById, holidays);
  const myResourceIds = resourceIdsByManager.get(session.userId) ?? [];
  const myResourceItems = computePersonalItems(boards, myResourceIds, userById, holidays);
  const teamItems = isSupervisor
    ? computePersonalItems(boards, withManagedResourceIds(teamMembers.map((m) => m.id)), userById, holidays)
    : [];

  const workloadThreshold = await getWorkloadThreshold();
  const workloadScopeIds = workloadScope.map((u) => u.id);
  const memberTasksMap = computeMemberTaskBreakdown(boards, workloadScopeIds, holidays, ownerDefaultAllocationPct);
  // Admins aren't limited to delegating their own work — they can split a
  // subtask off any task in the full hierarchy. Supervisors get a tree of
  // the ancestor paths of tasks assigned to them or their team, so they can
  // pick any level of their team's work as the new subtask's parent — a
  // supervisor with no assignments of their own still needs to be able to
  // add work under a team member's existing task.
  const parentTaskTree =
    session.role === "ADMIN"
      ? buildFullParentTree(visibleBoards, holidays)
      : buildSupervisorParentTree(boards, [session.userId, ...teamMembers.map((m) => m.id)], holidays);
  const weekColumns = computeWeekColumns(boards, holidays);
  const weeklyLoadMap = computeMemberWeeklyLoad(boards, workloadScopeIds, weekColumns, holidays, ownerDefaultAllocationPct);

  const tasksByUser: Record<string, MemberTask[]> = {};
  const weeklyLoadByUser: Record<string, number[]> = {};
  for (const id of workloadScopeIds) {
    tasksByUser[id] = memberTasksMap.get(id) ?? [];
    weeklyLoadByUser[id] = weeklyLoadMap.get(id) ?? [];
  }

  // Float per item, so 過度配置 can say which of someone's stacked tasks
  // could actually slip. Board-wide: a Pred can cross groups.
  const floatByItemId: Record<string, number> = {};
  for (const board of boards) {
    const linkColumn = board.columns.find((c) => c.id === board.linkColumnId);
    const floats = computeCriticalPath(
      board.items,
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

  const memberItemWorkload: Record<string, Record<WorkloadPeriod, MemberItemWorkloadEntry[]>> = {};
  for (const id of workloadScopeIds) {
    memberItemWorkload[id] = {
      day: computeMemberItemWorkload(boards, id, "day", holidays, ownerDefaultAllocationPct),
      week: computeMemberItemWorkload(boards, id, "week", holidays, ownerDefaultAllocationPct),
      month: computeMemberItemWorkload(boards, id, "month", holidays, ownerDefaultAllocationPct),
    };
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">儀表板</h1>
        <DashboardBoardFilter
          key={filterBoardIds.join(",")}
          boards={allBoards.map((b) => ({ id: b.id, name: b.name }))}
          selectedIds={filterBoardIds}
        />
      </div>

      {/* Above the workload cards on purpose: money that has already been
          committed is the one thing on this page nobody can undo later. */}
      <BudgetAlertCard alerts={await budgetAlerts(session)} />

      {/* 風險、問題(含 Mantis 同步來的)還沒結案的,讓使用者一眼看到還有哪些事沒做完。 */}
      <OpenRisksCard
        rows={await loadOpenRiskRows(boards)}
        relatedUserIds={isSupervisor ? [session.userId, ...teamMembers.map((m) => m.id)] : [session.userId]}
        defaultAll={isAdmin}
      />

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
        leaveDays={await leaveDaysByUser()}
        allUsers={users}
        currentUserId={session.userId}
        userRole={session.role}
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

      <DueListsSection
        overdue={overdue}
        completedThisWeek={completedThisWeek}
        upcoming7={upcoming7}
        upcoming30={upcoming30}
        allUsers={users}
        currentUserId={session.userId}
        userRole={session.role}
      />

      <TodoDeadlinesSection
        entries={todoDeadlines}
        today={taipeiClock(new Date()).date}
        allUsers={users}
        currentUserId={session.userId}
        userRole={session.role}
      />

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
