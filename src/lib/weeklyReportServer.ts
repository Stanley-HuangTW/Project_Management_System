import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { boardWithDataArgs, type BoardWithData } from "@/types/board";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { computeOverdueUpcoming } from "@/lib/dashboard";
import { computeStatusBuckets } from "@/lib/boardReport";
import { gatherDelayInputs } from "@/lib/delayInputs";
import { analyzeDelays } from "@/lib/delayAnalysis";
import { summarizeBudget } from "@/lib/budget";
import { getProgramView } from "@/lib/programView";
import {
  diffWeeks,
  renderWeeklyReportMarkdown,
  weekRangeOf,
  previousWeekOf,
  type BoardLine,
  type BudgetLine,
  type DelayLine,
  type DepartmentSection,
  type ItemBucket,
  type ProgramSection,
  type ReportItem,
  type WeeklyReportData,
  type WeeklyReportDiff,
} from "@/lib/weeklyReport";

/**
 * 週報的資料來源。
 *
 * 每一個數字都走畫面在用的那些函式(getProgramView、computeOverdueUpcoming、
 * computeStatusBuckets、analyzeDelays、summarizeBudget)—— 週報跟儀表板、
 * 群組甘特圖對不起來的時候,沒有人會知道該信哪一個。里程碑與要徑就是這樣
 * 來的:群組甘特圖已經在算了,這裡不重算第二套。
 *
 * 看得到哪些看板照 accessibleBoardWhere 走,所以週報永遠不會比那個人自己
 * 登入時看得更多。
 */

export type WeeklyReportSnapshot = WeeklyReportData;

/** 對應中文的部門名稱 —— GroupDiscipline 是四種工程職能。 */
const DISCIPLINE_LABELS: Record<string, string> = {
  SW: "SW 軟體",
  HW: "HW 硬體",
  ME: "ME 機構",
  QA: "QA 品保",
};

/** 哪個角色帶哪個職能。QA 的 DM 就是 QA 角色本身。 */
const DM_ROLE_OF: Record<string, string> = {
  SW: "SW_DM",
  HW: "HW_DM",
  ME: "ME_DM",
  QA: "QA",
};

export async function buildWeeklyReport(
  session: SessionPayload,
  weekStartIso: string
): Promise<{ snapshot: WeeklyReportSnapshot; diff: WeeklyReportDiff; markdown: string }> {
  const { weekStart, weekEnd } = weekRangeOf(weekStartIso);

  const [boards, holidayRows] = await Promise.all([
    prisma.board.findMany({ where: accessibleBoardWhere(session), ...boardWithDataArgs }),
    listHolidays(),
  ]);
  const holidays = toHolidaySet(holidayRows);

  // 逾期/七天內到期照儀表板那支算,一次算完再分給各專案。
  const { overdue, upcoming } = computeOverdueUpcoming(boards, undefined, holidays);
  const bucketOf = new Map<string, ItemBucket>();
  for (const e of overdue) bucketOf.set(e.itemId, "overdue");
  for (const e of upcoming) bucketOf.set(e.itemId, "upcoming");

  const programIds = [...new Set(boards.map((b) => b.programId).filter((id): id is string => !!id))];
  const programs = await prisma.program.findMany({
    where: { id: { in: programIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const sections: ProgramSection[] = [];
  for (const program of programs) {
    const view = await getProgramView(program.id, session);
    if (!view) continue;
    const mine = boards.filter((b) => b.programId === program.id);
    sections.push({
      programName: program.name,
      boards: boardLinesOf(mine, program.name, holidays),
      items: view.tasks.map((task) => ({
        id: task.id,
        wbsCode: task.wbsCode,
        name: task.name,
        boardName: task.boardName,
        groupName: task.groupName,
        programName: program.name,
        start: task.start,
        end: task.end,
        status: task.status,
        ownerIds: task.assigneeIds,
        ownerNames: task.assigneeNames,
        isMilestone: task.isMilestone,
        isCritical: task.isCritical,
        bucket: resolveBucket(task.id, task.status, bucketOf, doneIds(mine, holidays)),
      })),
      budgets: await gatherBudgets(mine),
      delays: await gatherDelays(mine, session),
    });
  }

  // 沒有歸屬專案群組的看板自己一段 —— 漏掉它們,那些工作項就整個消失了。
  const orphans = boards.filter((b) => !b.programId);
  if (orphans.length > 0) {
    sections.push({
      programName: null,
      boards: boardLinesOf(orphans, null, holidays),
      items: orphanItems(orphans, holidays, bucketOf),
      budgets: await gatherBudgets(orphans),
      delays: await gatherDelays(orphans, session),
    });
  }

  const snapshot: WeeklyReportSnapshot = {
    weekStart,
    weekEnd,
    generatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    viewerName: session.name,
    programs: sections,
    departments: await gatherDepartments(boards, sections),
    activity: await gatherActivity(boards, weekStart, weekEnd),
  };

  const previous = await loadSnapshot(session.userId, previousWeekOf(weekStart).weekStart);
  const diff = diffWeeks(snapshot, previous);
  return { snapshot, diff, markdown: renderWeeklyReportMarkdown(snapshot, diff) };
}

/** 已完成的項目 id —— 照看板自己的「報表完成狀態」設定判定。 */
function doneIds(boards: BoardWithData[], holidays: Set<string>): Set<string> {
  const ids = new Set<string>();
  for (const board of boards) {
    const done = new Set(board.reportDoneOptionIds);
    if (done.size === 0 || !board.reportStatusColumnId) continue;
    for (const item of board.items) {
      const value = item.cellValues.find((cv) => cv.columnId === board.reportStatusColumnId)?.value;
      if (typeof value === "string" && done.has(value)) ids.add(item.id);
    }
  }
  void holidays;
  return ids;
}

/** 已完成優先於逾期 —— 跟畫面上的分桶規則同一個順序。 */
function resolveBucket(
  itemId: string,
  status: string | null,
  bucketOf: Map<string, ItemBucket>,
  done: Set<string>
): ItemBucket {
  void status;
  if (done.has(itemId)) return "done";
  return bucketOf.get(itemId) ?? "other";
}

function boardLinesOf(
  boards: BoardWithData[],
  programName: string | null,
  holidays: Set<string>
): BoardLine[] {
  return boards.map((board) => {
    const counts = computeStatusBuckets(board, board.items, holidays);
    return {
      boardId: board.id,
      boardName: board.name,
      programName,
      total: counts.total,
      done: counts.done,
      overdue: counts.overdue,
      inProgress: counts.inProgress,
      notStarted: counts.notStarted + counts.planned,
    };
  });
}

/**
 * 沒有專案群組的看板拿不到 getProgramView,所以這裡自己攤平。
 *
 * 少了里程碑與要徑 —— 那兩個是跨看板算出來的,一塊孤立的看板沒有那個網絡。
 * 標成 false 而不是假裝算得出來。
 */
function orphanItems(
  boards: BoardWithData[],
  holidays: Set<string>,
  bucketOf: Map<string, ItemBucket>
): ReportItem[] {
  const done = doneIds(boards, holidays);
  const out: ReportItem[] = [];
  for (const board of boards) {
    const groupName = new Map(board.groups.map((g) => [g.id, g.name]));
    for (const item of board.items) {
      out.push({
        id: item.id,
        wbsCode: "",
        name: item.name,
        boardName: board.name,
        groupName: groupName.get(item.groupId) ?? "",
        programName: null,
        start: null,
        end: null,
        status: null,
        ownerIds: item.assignments.map((a) => a.user.id),
        ownerNames: item.assignments.map((a) => a.user.name),
        isMilestone: false,
        isCritical: false,
        bucket: done.has(item.id) ? "done" : (bucketOf.get(item.id) ?? "other"),
      });
    }
  }
  return out;
}

/**
 * 各部門的工作事項。
 *
 * 部門是掛在分組底下的:同一個 SW 在 M3 跟在 AMR BOX 是不同一組人,所以
 * 一個分組的一個職能算一個部門。DM 從分組角色來,成員從分組名冊來,工作
 * 項則是「指派給這些成員的」——按人分,而不是按項目上的某個欄位分,因為
 * 實際上是人被指派了工作,不是工作被標了部門。
 */
async function gatherDepartments(
  boards: BoardWithData[],
  sections: ProgramSection[]
): Promise<DepartmentSection[]> {
  const groupIds = boards.flatMap((b) => b.groups.map((g) => g.id));
  if (groupIds.length === 0) return [];

  const [roles, members] = await Promise.all([
    prisma.groupRoleAssignment.findMany({
      where: { groupId: { in: groupIds } },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.groupMember.findMany({
      where: { groupId: { in: groupIds } },
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);
  if (members.length === 0) return [];

  const itemsByOwner = new Map<string, ReportItem[]>();
  for (const item of sections.flatMap((s) => s.items)) {
    for (const ownerId of item.ownerIds) {
      itemsByOwner.set(ownerId, [...(itemsByOwner.get(ownerId) ?? []), item]);
    }
  }

  const groupInfo = new Map<string, { groupName: string; boardName: string }>();
  for (const board of boards) {
    for (const group of board.groups) {
      groupInfo.set(group.id, { groupName: group.name, boardName: board.name });
    }
  }

  const out: DepartmentSection[] = [];
  const byKey = new Map<string, typeof members>();
  for (const member of members) {
    const key = `${member.groupId}:${member.discipline}`;
    byKey.set(key, [...(byKey.get(key) ?? []), member]);
  }

  for (const [key, roster] of byKey) {
    const [groupId, discipline] = key.split(":");
    const info = groupInfo.get(groupId);
    if (!info) continue;

    const dmRole = DM_ROLE_OF[discipline];
    const dmNames = roles
      .filter((r) => r.groupId === groupId && r.role === dmRole)
      .map((r) => r.user.name);

    // 同一項可能指派給同部門兩個人,收斂成一份,不然同一件事會列兩次。
    const seen = new Set<string>();
    const mine: ReportItem[] = [];
    for (const member of roster) {
      for (const item of itemsByOwner.get(member.userId) ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        mine.push(item);
      }
    }

    out.push({
      key,
      discipline: DISCIPLINE_LABELS[discipline] ?? discipline,
      groupName: info.groupName,
      boardName: info.boardName,
      dmNames,
      memberNames: roster.map((m) => m.user.name),
      overdue: mine.filter((i) => i.bucket === "overdue"),
      upcoming: mine.filter((i) => i.bucket === "upcoming"),
      inProgress: mine.filter((i) => i.bucket === "other"),
    });
  }

  return out.sort((a, b) => a.boardName.localeCompare(b.boardName) || a.discipline.localeCompare(b.discipline));
}

/** 每個專案群組算一次延誤 —— 要徑跟延誤都是跨看板的,一塊一塊算會低估。 */
async function gatherDelays(boards: BoardWithData[], session: SessionPayload): Promise<DelayLine[]> {
  if (boards.length === 0) return [];
  const { inputs, visibleIds } = await gatherDelayInputs(
    boards.map((b) => b.id),
    session
  );
  const analysis = analyzeDelays(inputs, visibleIds);
  // 沒有基準線就沒有「晚幾天」可談,不假裝算得出來。
  if (analysis.noBaseline || analysis.projectDelay <= 0) return [];
  return [
    {
      boardName: boards.map((b) => b.name).join("、"),
      projectDelayDays: analysis.projectDelay,
      culprits: analysis.culprits.slice(0, 5).map((c) => ({
        wbsCode: c.wbsCode,
        name: c.name,
        ownDelayDays: c.ownDelay,
        downstreamCount: c.downstreamCount,
      })),
    },
  ];
}

/** 每個有編預算的階段一列。金額全部轉成 number —— Decimal 過不了 JSON。 */
async function gatherBudgets(boards: BoardWithData[]): Promise<BudgetLine[]> {
  const boardIds = boards.map((b) => b.id);
  if (boardIds.length === 0) return [];

  const budgetRows = (
    await prisma.budget.findMany({
      where: { itemId: { not: null }, item: { boardId: { in: boardIds }, deletedAt: null } },
      include: { item: { select: { id: true, name: true, boardId: true, parentId: true } } },
    })
  ).flatMap((row) => (row.item ? [{ ...row, itemId: row.itemId as string, item: row.item }] : []));
  if (budgetRows.length === 0) return [];

  const phaseIds = [...new Set(budgetRows.map((b) => b.itemId))];
  const allItems = await prisma.item.findMany({
    where: { boardId: { in: boardIds }, deletedAt: null },
    select: { id: true, parentId: true },
  });

  // 預算涵蓋那一列底下整棵子樹,花費也要照整棵子樹收。
  const childrenOf = new Map<string, string[]>();
  for (const item of allItems) {
    if (!item.parentId) continue;
    childrenOf.set(item.parentId, [...(childrenOf.get(item.parentId) ?? []), item.id]);
  }
  const subtreeOf = (rootId: string): string[] => {
    const out: string[] = [];
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      out.push(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
    return out;
  };

  const subtrees = new Map(phaseIds.map((id) => [id, subtreeOf(id)]));
  const everyId = [...new Set([...subtrees.values()].flat())];
  const [expenses, commitments] = await Promise.all([
    prisma.expense.findMany({ where: { itemId: { in: everyId } } }),
    prisma.commitment.findMany({ where: { itemId: { in: everyId }, settled: false } }),
  ]);

  const boardName = new Map(boards.map((b) => [b.id, b.name]));
  const lines: BudgetLine[] = [];
  for (const phaseId of phaseIds) {
    const mine = new Set(subtrees.get(phaseId) ?? []);
    const item = budgetRows.find((b) => b.itemId === phaseId)!.item;
    const summary = summarizeBudget({
      budgets: budgetRows
        .filter((b) => b.itemId === phaseId)
        .map((b) => ({ category: b.category, amount: b.amount })),
      actuals: expenses
        .filter((e) => mine.has(e.itemId))
        .map((e) => ({ category: e.category, amount: Number(e.amount) })),
      commitments: commitments
        .filter((c) => mine.has(c.itemId))
        .map((c) => ({ category: c.category, amount: Number(c.amount) })),
    });
    const { budget, actual, committed } = summary.total;
    lines.push({
      itemId: phaseId,
      boardName: boardName.get(item.boardId) ?? "",
      phaseName: item.name,
      approved: budget,
      spent: actual,
      committed,
      remaining: budget - actual - committed,
      over: summary.isOver,
    });
  }
  return lines.sort((a, b) => Number(b.over) - Number(a.over) || a.remaining - b.remaining);
}

/** 這一週每塊看板有幾筆異動。週末那一天也要算進去,所以比到隔天零點。 */
async function gatherActivity(
  boards: BoardWithData[],
  weekStart: string,
  weekEnd: string
): Promise<{ boardName: string; count: number }[]> {
  const boardIds = boards.map((b) => b.id);
  if (boardIds.length === 0) return [];

  const rows = await prisma.activityLogEntry.groupBy({
    by: ["boardId"],
    where: {
      boardId: { in: boardIds },
      createdAt: {
        gte: new Date(`${weekStart}T00:00:00.000Z`),
        lt: new Date(new Date(`${weekEnd}T00:00:00.000Z`).getTime() + 86_400_000),
      },
    },
    _count: { _all: true },
  });

  const boardName = new Map(boards.map((b) => [b.id, b.name]));
  return rows
    .filter((r) => r.boardId !== null)
    .map((r) => ({ boardName: boardName.get(r.boardId!) ?? "", count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 上一週那一份。
 *
 * 舊版的快照沒有 programs 這個欄位 —— 回 null 當成「沒得比」,因為拿不到
 * 逐項名單就算不出差異,硬比會把整份名單都說成這週新增的。
 */
async function loadSnapshot(userId: string, weekStart: string): Promise<WeeklyReportSnapshot | null> {
  const row = await prisma.weeklyReport.findUnique({
    where: { userId_weekStart: { userId, weekStart } },
    select: { data: true },
  });
  if (!row) return null;
  const data = row.data as unknown as Partial<WeeklyReportSnapshot>;
  return Array.isArray(data.programs) ? (data as WeeklyReportSnapshot) : null;
}

/** 產出並存檔。同一個人同一週再跑一次就覆蓋,不會長出第二份。 */
export async function generateAndStoreWeeklyReport(session: SessionPayload, weekStartIso: string) {
  const { snapshot, diff, markdown } = await buildWeeklyReport(session, weekStartIso);
  await prisma.weeklyReport.upsert({
    where: { userId_weekStart: { userId: session.userId, weekStart: snapshot.weekStart } },
    create: {
      userId: session.userId,
      weekStart: snapshot.weekStart,
      weekEnd: snapshot.weekEnd,
      data: snapshot as unknown as object,
      markdown,
    },
    update: { weekEnd: snapshot.weekEnd, data: snapshot as unknown as object, markdown },
  });
  return { snapshot, diff, markdown };
}
