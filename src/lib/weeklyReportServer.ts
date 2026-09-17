import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { boardWithDataArgs, type BoardWithData } from "@/types/board";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { computeWbsCodes } from "@/lib/wbs";
import { computeOverdueUpcoming } from "@/lib/dashboard";
import { computeStatusBuckets, groupItemsByBucket } from "@/lib/boardReport";
import { gatherDelayInputs } from "@/lib/delayInputs";
import { analyzeDelays } from "@/lib/delayAnalysis";
import { summarizeBudget } from "@/lib/budget";
import {
  diffWeeks,
  renderWeeklyReportMarkdown,
  weekRangeOf,
  previousWeekOf,
  type BoardLine,
  type BudgetLine,
  type DelayLine,
  type ReportItem,
  type WeeklyReportData,
  type WeeklyReportDiff,
} from "@/lib/weeklyReport";

/**
 * 週報的資料來源。
 *
 * 每一個數字都走畫面在用的那些函式(computeOverdueUpcoming、
 * computeStatusBuckets、analyzeDelays、summarizeBudget)—— 週報跟儀表板
 * 對不起來的時候,沒有人會知道該信哪一個。
 *
 * 看得到哪些看板照 accessibleBoardWhere 走,所以週報永遠不會比那個人自己
 * 登入時看得更多。
 */

/** 這一週的已完成清單也要存,下一週才比得出「這週完成了什麼」。 */
export type WeeklyReportSnapshot = WeeklyReportData & { done: ReportItem[] };

function itemShape(
  item: { id: string; name: string; groupId: string },
  board: BoardWithData,
  wbs: Map<string, string>,
  end: string
): ReportItem {
  return {
    id: item.id,
    wbsCode: wbs.get(item.id) ?? "",
    name: item.name,
    boardName: board.name,
    groupName: board.groups.find((g) => g.id === item.groupId)?.name ?? "",
    end,
  };
}

/** 一塊看板裡每個項目的 WBS —— 代號是在自己分組樹裡的位置,一個分組算一次。 */
function wbsOf(board: BoardWithData): Map<string, string> {
  const codes = new Map<string, string>();
  for (const group of board.groups) {
    const mine = board.items.filter((i) => i.groupId === group.id);
    for (const [id, code] of computeWbsCodes(mine)) codes.set(id, code);
  }
  return codes;
}

export async function buildWeeklyReport(
  session: SessionPayload,
  weekStartIso: string
): Promise<{ snapshot: WeeklyReportSnapshot; diff: WeeklyReportDiff; markdown: string }> {
  const { weekStart, weekEnd } = weekRangeOf(weekStartIso);

  const [boards, holidayRows, programs] = await Promise.all([
    prisma.board.findMany({ where: accessibleBoardWhere(session), ...boardWithDataArgs }),
    listHolidays(),
    prisma.program.findMany({ select: { id: true, name: true } }),
  ]);
  const programName = new Map(programs.map((p) => [p.id, p.name]));
  const holidays = toHolidaySet(holidayRows);

  const { overdue, upcoming } = computeOverdueUpcoming(boards, undefined, holidays);

  const boardLines: BoardLine[] = [];
  const done: ReportItem[] = [];
  for (const board of boards) {
    const counts = computeStatusBuckets(board, board.items, holidays);
    boardLines.push({
      boardId: board.id,
      boardName: board.name,
      programName: board.programId ? (programName.get(board.programId) ?? null) : null,
      total: counts.total,
      done: counts.done,
      overdue: counts.overdue,
      inProgress: counts.inProgress,
      notStarted: counts.notStarted + counts.planned,
    });

    // 已完成的那一桶要逐項存下來,下一週才知道哪幾項是新完成的。
    const wbs = wbsOf(board);
    const buckets = groupItemsByBucket(board, board.items, holidays);
    for (const item of buckets.done) done.push(itemShape(item, board, wbs, ""));
  }

  const shape = (list: typeof overdue): ReportItem[] =>
    list.map((e) => ({
      id: e.itemId,
      wbsCode: e.wbsCode,
      name: e.itemName,
      boardName: e.boardName,
      groupName: e.groupName,
      end: e.end.toISOString().slice(0, 10),
    }));

  const [delays, budgets, activity] = await Promise.all([
    gatherDelays(boards, session),
    gatherBudgets(boards),
    gatherActivity(boards, weekStart, weekEnd),
  ]);

  const snapshot: WeeklyReportSnapshot = {
    weekStart,
    weekEnd,
    generatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    viewerName: session.name,
    boards: boardLines,
    overdue: shape(overdue),
    upcoming: shape(upcoming),
    doneTotal: done.length,
    budgets,
    delays,
    activity,
    done,
  };

  const previous = await loadSnapshot(session.userId, previousWeekOf(weekStart).weekStart);
  const diff = diffWeeks(
    { done: snapshot.done, overdue: snapshot.overdue },
    previous ? { done: previous.done, overdue: previous.overdue } : null
  );

  return { snapshot, diff, markdown: renderWeeklyReportMarkdown(snapshot, diff) };
}

/** 每個專案群組算一次延誤 —— 要徑跟延誤都是跨看板的,一塊一塊算會低估。 */
async function gatherDelays(boards: BoardWithData[], session: SessionPayload): Promise<DelayLine[]> {
  const byProgram = new Map<string, BoardWithData[]>();
  for (const board of boards) {
    const key = board.programId ?? `solo:${board.id}`;
    byProgram.set(key, [...(byProgram.get(key) ?? []), board]);
  }

  const lines: DelayLine[] = [];
  for (const group of byProgram.values()) {
    const { inputs, visibleIds } = await gatherDelayInputs(
      group.map((b) => b.id),
      session
    );
    const analysis = analyzeDelays(inputs, visibleIds);
    // 沒有基準線就沒有「晚幾天」可談,不假裝算得出來。
    if (analysis.noBaseline || analysis.projectDelay <= 0) continue;
    lines.push({
      boardName: group.map((b) => b.name).join("、"),
      projectDelayDays: analysis.projectDelay,
      culprits: analysis.culprits.slice(0, 5).map((c) => ({
        wbsCode: c.wbsCode,
        name: c.name,
        ownDelayDays: c.ownDelay,
        downstreamCount: c.downstreamCount,
      })),
    });
  }
  return lines;
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
      budgets: budgetRows.filter((b) => b.itemId === phaseId).map((b) => ({ category: b.category, amount: b.amount })),
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

async function loadSnapshot(userId: string, weekStart: string): Promise<WeeklyReportSnapshot | null> {
  const row = await prisma.weeklyReport.findUnique({
    where: { userId_weekStart: { userId, weekStart } },
    select: { data: true },
  });
  return row ? (row.data as unknown as WeeklyReportSnapshot) : null;
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
