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
  type PersonSection,
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

/** 對應中文的部門名稱 —— GroupDiscipline 是五種職能。 */
const DISCIPLINE_LABELS: Record<string, string> = {
  SW: "SW 軟體",
  HW: "EE 電機",
  ME: "ME 機構",
  QA: "QA 品保",
  PM: "PM 專案管理",
};

/** 哪個角色帶哪個職能。QA 的 DM 就是 QA 角色本身。 */
const DM_ROLE_OF: Record<string, string> = {
  SW: "SW_DM",
  HW: "HW_DM",
  ME: "ME_DM",
  QA: "QA",
  PM: "PM_DM",
};

export async function buildWeeklyReport(
  session: SessionPayload,
  weekStartIso: string,
  upcomingDays = 7
): Promise<{ snapshot: WeeklyReportSnapshot; diff: WeeklyReportDiff; markdown: string }> {
  const { weekStart, weekEnd } = weekRangeOf(weekStartIso);

  const [boards, holidayRows] = await Promise.all([
    prisma.board.findMany({ where: accessibleBoardWhere(session), ...boardWithDataArgs }),
    listHolidays(),
  ]);
  const holidays = toHolidaySet(holidayRows);

  // 逾期/未來幾天到期照儀表板那支算,一次算完再分給各專案跟各部門——同一份
  // report 裡「未來幾天」的定義只有一個,不會專案區塊跟部門區塊各自算。
  const { overdue, upcoming } = computeOverdueUpcoming(boards, undefined, holidays, upcomingDays);
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

  // diff 要先算出來,才有「這週已完成」的名單可以分給各部門/各人——見
  // gatherPersonSections 的說明。diffWeeks 只讀 current.programs,所以在
  // snapshot 組完整之前先用 sections 算是等價的。
  const previous = await loadSnapshot(session.userId, previousWeekOf(weekStart).weekStart);
  const diff = diffWeeks({ programs: sections }, previous);

  const snapshot: WeeklyReportSnapshot = {
    weekStart,
    weekEnd,
    generatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    viewerName: session.name,
    programs: sections,
    departments: await gatherPersonSections(boards, sections, diff.completed),
    upcomingDays,
    activity: await gatherActivity(boards, weekStart, weekEnd),
  };

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
 * 每個人自己手上的事:逾期、這週完成、接下來要到期的。
 *
 * 帶人的人要問的是「我的人手上有什麼」,聚合成一個部門的清單看不出是誰在
 * 忙、誰很閒,所以一個人一份,不再是一個「分組 × 職能」聚合成一份。DM/
 * 成員從分組角色與名冊來;Team Leader 沒有單一職能,但一樣要看得到他自己
 * 名下的工作項,所以另外整理一份、不掛在任何職能底下。
 *
 * 「這週已完成」不是重新算的——上層 diffWeeks 已經比出這週跟上週的差異,
 * completedThisWeek 這裡直接拿那份結果依 ownerIds 分,是同一份資料源。
 */
async function gatherPersonSections(
  boards: BoardWithData[],
  sections: ProgramSection[],
  completedThisWeek: ReportItem[]
): Promise<PersonSection[]> {
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
  if (roles.length === 0 && members.length === 0) return [];

  const itemsByOwner = new Map<string, ReportItem[]>();
  for (const item of sections.flatMap((s) => s.items)) {
    for (const ownerId of item.ownerIds) {
      itemsByOwner.set(ownerId, [...(itemsByOwner.get(ownerId) ?? []), item]);
    }
  }
  const completedByOwner = new Map<string, ReportItem[]>();
  for (const item of completedThisWeek) {
    for (const ownerId of item.ownerIds) {
      completedByOwner.set(ownerId, [...(completedByOwner.get(ownerId) ?? []), item]);
    }
  }

  const groupInfo = new Map<string, { groupName: string; boardName: string }>();
  for (const board of boards) {
    for (const group of board.groups) {
      groupInfo.set(group.id, { groupName: group.name, boardName: board.name });
    }
  }

  function personSection(
    userId: string,
    userName: string,
    role: PersonSection["role"],
    discipline: string,
    info: { groupName: string; boardName: string }
  ): PersonSection {
    const mine = itemsByOwner.get(userId) ?? [];
    return {
      userId,
      userName,
      role,
      discipline,
      groupName: info.groupName,
      boardName: info.boardName,
      overdue: mine.filter((i) => i.bucket === "overdue"),
      completedThisWeek: completedByOwner.get(userId) ?? [],
      upcoming: mine.filter((i) => i.bucket === "upcoming"),
    };
  }

  const out: PersonSection[] = [];
  // 名冊上的人;是不是那個職能的 DM 另外查角色表,同一個人不會被列兩次。
  const seen = new Set<string>();
  for (const member of members) {
    const info = groupInfo.get(member.groupId);
    if (!info) continue;
    const key = `${member.groupId}:${member.discipline}:${member.userId}`;
    seen.add(key);
    const isDm = roles.some(
      (r) =>
        r.groupId === member.groupId &&
        r.userId === member.userId &&
        r.role === DM_ROLE_OF[member.discipline]
    );
    out.push(
      personSection(
        member.userId,
        member.user.name,
        isDm ? "DM" : "MEMBER",
        DISCIPLINE_LABELS[member.discipline] ?? member.discipline,
        info
      )
    );
  }

  // 掛了 DM 角色、但沒被列進名冊的人(角色跟名冊是兩份獨立設定)——一樣要
  // 看得到,不然這個部門的 DM 憑空消失。
  for (const [discipline, dmRole] of Object.entries(DM_ROLE_OF)) {
    for (const r of roles.filter((r) => r.role === dmRole)) {
      const info = groupInfo.get(r.groupId);
      if (!info) continue;
      const key = `${r.groupId}:${discipline}:${r.userId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(personSection(r.userId, r.user.name, "DM", DISCIPLINE_LABELS[discipline] ?? discipline, info));
    }
  }

  // Team Leader 自己的工作項,不掛在任何一個職能底下。
  for (const tl of roles.filter((r) => r.role === "TEAM_LEADER")) {
    const info = groupInfo.get(tl.groupId);
    if (!info) continue;
    out.push(personSection(tl.userId, tl.user.name, "TEAM_LEADER", "Team Leader", info));
  }

  return out.sort(
    (a, b) =>
      a.boardName.localeCompare(b.boardName) ||
      a.groupName.localeCompare(b.groupName) ||
      a.discipline.localeCompare(b.discipline) ||
      a.userName.localeCompare(b.userName)
  );
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

/**
 * 每個有編預算的階段一列。金額全部轉成 number —— Decimal 過不了 JSON。
 *
 * 預算可以掛在「預算階段」上,也可以掛在看板上的一列工作項上,兩種都要收:
 * 階段是計畫的單位,而花費一律記在看板的工作項底下,所以階段要透過它對應
 * 到的那一列去收實際數字。沒對應的階段只有核准金額,實際與已下單是 0。
 */
async function gatherBudgets(boards: BoardWithData[]): Promise<BudgetLine[]> {
  const boardIds = boards.map((b) => b.id);
  if (boardIds.length === 0) return [];

  const [phaseHeld, itemHeld] = await Promise.all([
    prisma.budget.findMany({
      where: { phaseId: { not: null }, phase: { boardId: { in: boardIds } } },
      include: { phase: { select: { id: true, name: true, boardId: true, itemId: true } } },
    }),
    prisma.budget.findMany({
      where: { itemId: { not: null }, item: { boardId: { in: boardIds }, deletedAt: null } },
      include: { item: { select: { id: true, name: true, boardId: true, parentId: true } } },
    }),
  ]);

  // 一列一個範圍:scopeId 是它的身分(階段 id 或工作項 id),rootId 是實際
  // 花費要從哪一列往下收 —— 未對應的階段沒有那一列,所以是 null。
  const scopes = [
    ...phaseHeld.flatMap((row) =>
      row.phase
        ? [
            {
              scopeId: row.phase.id,
              name: row.phase.name,
              boardId: row.phase.boardId,
              rootId: row.phase.itemId,
              category: row.category,
              amount: row.amount,
            },
          ]
        : []
    ),
    ...itemHeld.flatMap((row) =>
      row.item
        ? [
            {
              scopeId: row.item.id,
              name: row.item.name,
              boardId: row.item.boardId,
              rootId: row.item.id,
              category: row.category,
              amount: row.amount,
            },
          ]
        : []
    ),
  ];
  if (scopes.length === 0) return [];

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

  const scopeIds = [...new Set(scopes.map((s) => s.scopeId))];
  const subtrees = new Map(
    scopes.map((s) => [s.scopeId, s.rootId ? subtreeOf(s.rootId) : []])
  );
  const everyId = [...new Set([...subtrees.values()].flat())];
  const [expenses, commitments] = await Promise.all([
    prisma.expense.findMany({ where: { itemId: { in: everyId } } }),
    prisma.commitment.findMany({ where: { itemId: { in: everyId }, settled: false } }),
  ]);

  const boardName = new Map(boards.map((b) => [b.id, b.name]));
  const lines: BudgetLine[] = [];
  for (const scopeId of scopeIds) {
    const mine = new Set(subtrees.get(scopeId) ?? []);
    const scope = scopes.find((s) => s.scopeId === scopeId)!;
    const summary = summarizeBudget({
      budgets: scopes
        .filter((s) => s.scopeId === scopeId)
        .map((s) => ({ category: s.category, amount: s.amount })),
      actuals: expenses
        .filter((e) => mine.has(e.itemId))
        .map((e) => ({ category: e.category, amount: Number(e.amount) })),
      commitments: commitments
        .filter((c) => mine.has(c.itemId))
        .map((c) => ({ category: c.category, amount: Number(c.amount) })),
    });
    const { budget, actual, committed } = summary.total;
    lines.push({
      itemId: scopeId,
      boardName: boardName.get(scope.boardId) ?? "",
      phaseName: scope.name,
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
