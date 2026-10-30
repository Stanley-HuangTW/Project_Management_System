"use server";

import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import type { CostCategory, ReserveKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, canAccessBoard } from "@/lib/boardAccess";
import { hideBudgetOn } from "@/lib/dmScopeServer";
import {
  summarizeBudget,
  summarizeReserves,
  alertLevel,
  type BudgetSummary,
  type BudgetAlertLevel,
  type ReserveState,
} from "@/lib/budget";
import {
  computeBudgetForecast,
  weightedFractionDone,
  type BudgetForecast,
} from "@/lib/budgetForecast";
import { getItemDateRange } from "@/lib/gantt";
import { countDaysInRange } from "@/lib/workday";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { logAudit } from "@/lib/activityLog";
import { toMoney, fxExposure, isBaseCurrency } from "@/lib/currency";
import { effectiveRateMap } from "@/lib/labourRate";
import { refreshBomMaterial } from "@/lib/bomMaterial";
import { nreByCostCategory, planNreApply, type NreApplyPlan } from "@/lib/nre";
import { UserError } from "@/lib/userError";

/**
 * 預算核准的三個層級:預算階段、看板上的一列工作項,或整個專案群組。
 *
 * "phase" 是人力表上畫出來的預算階段 —— 預算與準備金掛在它身上;"item" 是
 * 看板上真的那一列,實際花費(訂單、支出、工時)記在它底下。兩者刻意分開:
 * 預估的金額與實際發生的金額不會一樣,混成一筆就比不出差距。
 *
 * 一個階段可以對應到一列工作項(BudgetPhase.itemId);沒對應的階段仍然編得
 * 出預算,只是還沒有實際數字可以跟它對。
 */
export type BudgetScope =
  | { kind: "phase"; id: string }
  | { kind: "item"; id: string }
  | { kind: "program"; id: string }
  /**
   * 整個看板(專案)所有階段的合計,**唯讀**:id 是看板的 id。核准預算與準備金是各階段加總,沒有
   * 自己的一份可以設定;實際花費與訂單是這個看板上所有工作項的(包含沒有對應到任何階段的)。
   */
  | { kind: "board"; id: string };

const BOARD_SCOPE_READ_ONLY = "整個專案是各階段的合計,沒有自己的預算可以設定——請選單一階段";

/** 這個範圍的預算/準備金掛在哪個外鍵上。 */
function scopeKey(scope: BudgetScope) {
  if (scope.kind === "board") throw new UserError(BOARD_SCOPE_READ_ONLY);
  if (scope.kind === "phase") return { phaseId: scope.id };
  if (scope.kind === "item") return { itemId: scope.id };
  return { programId: scope.id };
}

/** 讀預算與準備金時用的條件:整個專案是它底下所有階段的那幾列,其他範圍是自己的外鍵。 */
function scopeReadWhere(scope: BudgetScope) {
  return scope.kind === "board" ? { phase: { boardId: scope.id } } : scopeKey(scope);
}

function budgetWhereUnique(scope: BudgetScope, category: CostCategory) {
  if (scope.kind === "board") throw new UserError(BOARD_SCOPE_READ_ONLY);
  if (scope.kind === "phase") return { phaseId_category: { phaseId: scope.id, category } };
  if (scope.kind === "item") return { itemId_category: { itemId: scope.id, category } };
  return { programId_category: { programId: scope.id, category } };
}

function reserveWhereUnique(scope: BudgetScope, kind: ReserveKind) {
  if (scope.kind === "board") throw new UserError(BOARD_SCOPE_READ_ONLY);
  if (scope.kind === "phase") return { phaseId_kind: { phaseId: scope.id, kind } };
  if (scope.kind === "item") return { itemId_kind: { itemId: scope.id, kind } };
  return { programId_kind: { programId: scope.id, kind } };
}

export type AttachmentRow = { id: string; fileName: string; size: number };

export type CommitmentRow = {
  id: string;
  itemId: string;
  itemName: string;
  attachments: AttachmentRow[];
  category: CostCategory;
  /** 換算後的台幣,凍結在下單當下。 */
  amount: number;
  currency: string;
  originalAmount: number;
  fxRate: number;
  vendor: string;
  poNumber: string;
  expectedDate: string | null;
  settled: boolean;
  note: string;
};

export type ExpenseRow = {
  id: string;
  itemId: string;
  itemName: string;
  attachments: AttachmentRow[];
  category: CostCategory;
  /** 換算後的台幣,凍結在記帳當下。 */
  amount: number;
  currency: string;
  originalAmount: number;
  fxRate: number;
  date: string;
  vendor: string;
  note: string;
};

export type BudgetView = {
  scopeName: string;
  summary: BudgetSummary;
  alert: BudgetAlertLevel;
  /** Every task inside this scope, for the picker that books a cost against
   *  one of them. Indented by depth so a 195-row list is still readable. */
  items: { id: string; name: string; depth: number; boardId: string; boardName: string }[];
  commitments: CommitmentRow[];
  expenses: ExpenseRow[];
  /** 人力實際成本 is derived, not booked, so it is stated separately — it is
   *  the one line nobody can reconcile against a receipt. */
  labourActual: number;
  /** 人力核准金額是不是人力規劃表算出來的 —— 是的話就不該再手填。 */
  labourFromPlan: boolean;
  /** 材料核准金額是不是樣機 BOM 算出來的 —— 是的話就不該再手填。 */
  materialFromBom: boolean;
  /**
   * NRE 報價單的估算金額,換成預算的費用類別(見 NRE_COST_CATEGORY)。是估算,按「帶入」(applyNreToBudget)才會改核准預算。
   * 單一階段:那個階段的報價單;整個專案:全部(含涵蓋整個專案的委託開發);projectWide 是單一階段看不到、
   * 但屬於這個專案的涵蓋整個專案的委託開發金額。
   */
  nre: { byCategory: Partial<Record<CostCategory, number>>; total: number; projectWide: number };
  /** 照這樣下去會花多少 — see budgetForecast.ts. */
  forecast: BudgetForecast;
  /** 目前可選的幣別與匯率,用來預填輸入框。 */
  rates: { code: string; rate: number }[];
  /** 未入帳的外幣訂單,若今天全部付款會多花(或少花)多少台幣。 */
  fxExposure: ReturnType<typeof fxExposure>;
  /** 成本基準之外的緩衝 — 應變與管理準備金。 */
  reserves: ReserveState;
  /** 動支紀錄,最近的在前。 */
  draws: {
    id: string;
    kind: ReserveKind;
    category: CostCategory;
    amount: number;
    reason: string;
    decidedByName: string | null;
    createdAt: string;
  }[];
  canEdit: boolean;
};

/**
 * Which tasks' ledgers roll up into this scope, and whether the caller may see
 * them at all.
 *
 * A budget on a phase covers that row and everything under it — the phase row
 * is where the money is approved, the work underneath is where it gets spent.
 */
async function resolveScope(
  scope: BudgetScope,
  session: Awaited<ReturnType<typeof requireSession>>
): Promise<{
  name: string;
  itemIds: string[];
  items: BudgetView["items"];
  /** 階段自己排的起訖日。只有預算階段有 —— 工作項與專案群組的期間是從
   *  它們底下的工作項讀出來的。 */
  plannedRange?: { start: string; end: string };
} | null> {
  if (scope.kind === "phase") {
    const phase = await prisma.budgetPhase.findUnique({
      where: { id: scope.id },
      select: {
        name: true,
        boardId: true,
        itemId: true,
        startDate: true,
        endDate: true,
        board: { select: { name: true } },
      },
    });
    if (!phase) return null;
    await requireBoardAccess(phase.boardId, session);
    // DM 的可見範圍(系統設定):被限制「預算金額」的人,階段預算就當作看不到。
    if (await hideBudgetOn(phase.boardId, session)) return null;

    // 實際花費記在看板的工作項上,所以「這個階段實際花了多少」只有對應過去
    // 才問得到。沒對應的階段一樣編得出預算 —— 那正是它存在的意義:先有
    // 計畫,之後才去指出真實發生在哪一列。
    const all = phase.itemId
      ? await prisma.item.findMany({
          where: { boardId: phase.boardId, deletedAt: null },
          select: { id: true, name: true, parentId: true, order: true },
          orderBy: { order: "asc" },
        })
      : [];
    const plannedRange = { start: phase.startDate, end: phase.endDate };
    const linked = all.find((i) => i.id === phase.itemId);
    if (!linked) return { name: phase.name, itemIds: [], items: [], plannedRange };
    const subtree = collectSubtree(linked.id, all, phase.boardId, phase.board.name);
    return {
      name: phase.name,
      itemIds: subtree.map((i) => i.id),
      items: subtree,
      plannedRange,
    };
  }

  if (scope.kind === "item") {
    const root = await prisma.item.findUnique({
      where: { id: scope.id },
      select: { id: true, name: true, boardId: true, board: { select: { name: true } } },
    });
    if (!root) return null;
    await requireBoardAccess(root.boardId, session);
    if (await hideBudgetOn(root.boardId, session)) return null;

    const all = await prisma.item.findMany({
      where: { boardId: root.boardId, deletedAt: null },
      select: { id: true, name: true, parentId: true, order: true },
      orderBy: { order: "asc" },
    });
    const subtree = collectSubtree(root.id, all, root.boardId, root.board.name);
    return { name: root.name, itemIds: subtree.map((i) => i.id), items: subtree };
  }

  if (scope.kind === "board") {
    const board = await prisma.board.findUnique({ where: { id: scope.id }, select: { id: true, name: true } });
    if (!board) return null;
    await requireBoardAccess(board.id, session);
    if (await hideBudgetOn(board.id, session)) return null;
    const [all, phases] = await Promise.all([
      prisma.item.findMany({
        where: { boardId: board.id, deletedAt: null },
        select: { id: true, name: true, parentId: true, order: true },
        orderBy: { order: "asc" },
      }),
      prisma.budgetPhase.findMany({ where: { boardId: board.id }, select: { startDate: true, endDate: true } }),
    ]);
    const items: BudgetView["items"] = [];
    for (const root of all.filter((i) => i.parentId === null)) {
      items.push(...collectSubtree(root.id, all, board.id, board.name));
    }
    // 計畫支出的備用期間:所有階段排的起訖日的最早到最晚。
    const starts = phases.map((p) => p.startDate).sort();
    const ends = phases.map((p) => p.endDate).sort();
    return {
      name: `${board.name}(整個專案)`,
      itemIds: items.map((i) => i.id),
      items,
      plannedRange: starts.length > 0 ? { start: starts[0], end: ends[ends.length - 1] } : undefined,
    };
  }

  const program = await prisma.program.findUnique({
    where: { id: scope.id },
    select: { name: true, boards: { where: { deletedAt: null }, select: { id: true, name: true } } },
  });
  if (!program) return null;

  // A board the caller cannot open contributes nothing — its costs would
  // otherwise leak out as a total they were not meant to see.
  const items: BudgetView["items"] = [];
  for (const board of program.boards) {
    if (!(await canAccessBoard(session, board.id)) || (await hideBudgetOn(board.id, session))) continue;
    const all = await prisma.item.findMany({
      where: { boardId: board.id, deletedAt: null },
      select: { id: true, name: true, parentId: true, order: true },
      orderBy: { order: "asc" },
    });
    for (const root of all.filter((i) => i.parentId === null)) {
      items.push(...collectSubtree(root.id, all, board.id, board.name));
    }
  }
  return { name: program.name, itemIds: items.map((i) => i.id), items };
}

/** The row plus everything beneath it, in display order, with its indent. */
function collectSubtree(
  rootId: string,
  all: { id: string; name: string; parentId: string | null }[],
  boardId: string,
  boardName: string
): BudgetView["items"] {
  const out: BudgetView["items"] = [];
  const walk = (id: string, depth: number) => {
    const node = all.find((i) => i.id === id);
    if (!node) return;
    out.push({ id: node.id, name: node.name, depth, boardId, boardName });
    for (const child of all.filter((i) => i.parentId === id)) walk(child.id, depth + 1);
  };
  walk(rootId, 0);
  return out;
}

/**
 * Reads the scope's tasks for how far along they are and when they run, then
 * turns the ledgers into a forecast.
 */
async function forecastFor(
  itemIds: string[],
  budget: number,
  expenses: { date: string; amount: number }[],
  commitments: { date: string | null; amount: number }[],
  labour: number,
  boardIds: string[],
  /** 工作項讀不出日期時用的備用期間 —— 未對應的預算階段只有自己排的起訖日,
   *  沒有它的話計畫支出那條線整條畫不出來。 */
  fallbackRange?: { start: string; end: string }
): Promise<BudgetForecast> {
  const today = new Date().toISOString().slice(0, 10);
  const [boards, items, holidayRows] = await Promise.all([
    prisma.board.findMany({
      where: { id: { in: boardIds } },
      select: {
        id: true,
        progressColumnId: true,
        ganttStartColumnId: true,
        ganttDurationColumnId: true,
        ganttDurationMode: true,
      },
    }),
    prisma.item.findMany({
      where: { id: { in: itemIds }, deletedAt: null },
      select: { id: true, boardId: true, parentId: true, cellValues: true },
    }),
    listHolidays(),
  ]);
  const holidays = toHolidaySet(holidayRows);
  const boardById = new Map(boards.map((b) => [b.id, b]));
  // Leaves only: a summary's progress is its children's, counted twice.
  const parentIds = new Set(items.map((i) => i.parentId).filter(Boolean));

  const tasks: { progressPct: number | null; days: number | null }[] = [];
  let start: string | null = null;
  let end: string | null = null;

  for (const item of items) {
    const board = boardById.get(item.boardId);
    if (!board) continue;
    const range =
      board.ganttStartColumnId && board.ganttDurationColumnId
        ? getItemDateRange(
            item,
            board.ganttStartColumnId,
            board.ganttDurationColumnId,
            board.ganttDurationMode,
            holidays
          )
        : null;
    if (range) {
      const from = range.start.toISOString().slice(0, 10);
      const to = range.end.toISOString().slice(0, 10);
      if (start === null || from < start) start = from;
      if (end === null || to > end) end = to;
    }
    if (parentIds.has(item.id)) continue;

    const progress = board.progressColumnId
      ? item.cellValues.find((cv) => cv.columnId === board.progressColumnId)?.value
      : undefined;
    tasks.push({
      progressPct: typeof progress === "number" ? progress : null,
      days: range
        ? (countDaysInRange(range.start, range.end, board.ganttDurationMode, holidays) ?? 1)
        : null,
    });
  }

  return computeBudgetForecast({
    budget,
    expenses: [...expenses, ...(labour > 0 ? [{ date: today, amount: labour }] : [])],
    commitments,
    scheduleStart: start ?? fallbackRange?.start ?? null,
    scheduleEnd: end ?? fallbackRange?.end ?? null,
    fractionDone: weightedFractionDone(tasks),
    todayIso: today,
  });
}

/**
 * 人力實際成本 for a set of groups: approved timesheets × the person's rate.
 *
 * Never booked as an expense — the hours are already recorded, and typing
 * them in again as money would count the same work twice.
 */
async function labourActualFor(itemIds: string[]): Promise<number> {
  const entries = await prisma.timeEntry.findMany({
    where: { status: "APPROVED", itemId: { in: itemIds }, item: { deletedAt: null } },
    select: { userId: true, hours: true },
  });
  if (entries.length === 0) return 0;

  const rate = await effectiveRateMap();
  return entries.reduce((total, e) => total + Number(e.hours) * (rate.get(e.userId) ?? 0), 0);
}

/** 這個範圍的 NRE 報價單金額。看得到預算的人就看得到報價單(跟 NRE 報價單分頁同一個規則)。 */
async function nreFor(scope: BudgetScope, boardIds: string[]): Promise<BudgetView["nre"]> {
  const where =
    scope.kind === "phase"
      ? { phaseId: scope.id }
      : scope.kind === "board"
        ? { boardId: scope.id }
        : scope.kind === "item"
          ? { phase: { itemId: scope.id } }
          : { boardId: { in: boardIds } };
  const groups = await prisma.nreLine.groupBy({ by: ["category"], where, _sum: { amount: true } });
  const { byCategory, total } = nreByCostCategory(groups.map((g) => ({ category: g.category, amount: g._sum.amount ?? 0 })));

  // 單一階段看不到「涵蓋整個專案」的列(它不屬於任何階段),另外說一聲,免得以為漏了。
  let projectWide = 0;
  if (scope.kind === "phase") {
    const phase = await prisma.budgetPhase.findUnique({ where: { id: scope.id }, select: { boardId: true } });
    if (phase) {
      const wide = await prisma.nreLine.aggregate({ where: { boardId: phase.boardId, phaseId: null }, _sum: { amount: true } });
      projectWide = wide._sum.amount ?? 0;
    }
  }
  return { byCategory, total, projectWide };
}

export async function getBudgetView(scope: BudgetScope): Promise<BudgetView | null> {
  const session = await requireSession();
  const resolved = await resolveScope(scope, session);
  if (!resolved) return null;
  const { itemIds } = resolved;

  // 材料預算是 BOM × 樣機計畫算出來存起來的數字——看之前對一次,舊資料或沒走到重算的那條路也會補上。
  // 專案群組(program)不是階段,沒有 BOM 可對。
  if (scope.kind !== "program") {
    await refreshBomMaterial(
      await prisma.budgetPhase.findMany({
        where: scope.kind === "phase" ? { id: scope.id } : scope.kind === "board" ? { boardId: scope.id } : { itemId: scope.id },
        select: { id: true, boardId: true },
      })
    );
  }

  const [budgets, commitments, expenses, labour] = await Promise.all([
    prisma.budget.findMany({
      where: scopeReadWhere(scope),
      select: { category: true, amount: true },
    }),
    prisma.commitment.findMany({
      where: { itemId: { in: itemIds } },
      orderBy: [{ settled: "asc" }, { expectedDate: "asc" }],
      include: {
        item: { select: { name: true } },
        attachments: { select: { id: true, fileName: true, size: true } },
      },
    }),
    prisma.expense.findMany({
      where: { itemId: { in: itemIds } },
      orderBy: { date: "desc" },
      include: {
        item: { select: { name: true } },
        attachments: { select: { id: true, fileName: true, size: true } },
      },
    }),
    labourActualFor(itemIds),
  ]);

  const summary = summarizeBudget({
    budgets,
    actuals: [
      ...expenses.map((e) => ({ category: e.category, amount: e.amount })),
      { category: "LABOUR" as CostCategory, amount: Math.round(labour) },
    ],
    // 已結清的不再算進已承諾 — that money is now an expense.
    commitments: commitments
      .filter((c) => !c.settled)
      .map((c) => ({ category: c.category, amount: c.amount })),
  });

  // Progress and dates come from the scope's own tasks, read through their
  // board's Gantt columns — the same ones every other schedule view uses.
  const boardIds = [...new Set(resolved.items.map((i) => i.boardId))];
  const forecast = await forecastFor(
    resolved.itemIds,
    summary.total.budget,
    expenses.map((e) => ({ date: e.date, amount: e.amount })),
    commitments.filter((c) => !c.settled).map((c) => ({ date: c.expectedDate, amount: c.amount })),
    // 人力 is spend too, but it has no single date — it is added at today so
    // the totals agree with the summary above even though the curve cannot
    // place it in time.
    Math.round(labour),
    boardIds,
    resolved.plannedRange
  );

  const reserveRows = await prisma.reserve.findMany({
    where: scopeReadWhere(scope),
    include: {
      draws: {
        orderBy: { createdAt: "desc" },
        include: { decidedBy: { select: { name: true } } },
      },
    },
  });
  const allDraws = reserveRows.flatMap((r) =>
    r.draws.map((d) => ({ ...d, kind: r.kind }))
  );
  const reserves = summarizeReserves(
    reserveRows.map((r) => ({ kind: r.kind, amount: r.amount })),
    allDraws.map((d) => ({ kind: d.kind, amount: d.amount }))
  );

  // 匯率只用來預填輸入框,以及算未入帳外幣訂單的風險——每一筆帳用的仍然是
  // 它自己存下來的那個匯率。
  const rateRows = await prisma.exchangeRate.findMany({ select: { code: true, rate: true } });
  const currentRates = new Map(rateRows.map((r) => [r.code, Number(r.rate)]));

  return {
    scopeName: resolved.name,
    summary,
    alert: alertLevel(summary, 80, reserves.totalRemaining),
    forecast,
    rates: rateRows.map((r) => ({ code: r.code, rate: Number(r.rate) })),
    fxExposure: fxExposure(
      commitments
        .filter((c) => !c.settled)
        .map((c) => ({
          currency: c.currency,
          originalAmount: c.originalAmount,
          fxRate: Number(c.fxRate),
        })),
      currentRates
    ),
    reserves,
    draws: allDraws
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        category: d.category,
        amount: d.amount,
        reason: d.reason,
        decidedByName: d.decidedBy?.name ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
    items: resolved.items,
    labourActual: Math.round(labour),
    // 只有階段有人力規劃表;專案群組的人力是各階段加總,沒有自己的表。
    // 看板那一列問的是「有沒有階段對應到它、而且那個階段排了人月」——
    // 人月是掛在階段上的,不是掛在那一列自己底下。
    labourFromPlan:
      scope.kind === "phase"
        ? (await prisma.labourPlan.count({ where: { phaseId: scope.id } })) > 0
        : scope.kind === "board"
          ? (await prisma.labourPlan.count({ where: { phase: { boardId: scope.id } } })) > 0
          : scope.kind === "item" &&
            (await prisma.labourPlan.count({ where: { phase: { itemId: scope.id } } })) > 0,
    // 同一個道理:材料是不是由 BOM 驅動,看的是這個階段有沒有任何一筆
    // BomLine——不是看目前算出來的金額是不是 0(0 也可能是 BOM 算出來的)。
    materialFromBom:
      scope.kind === "phase"
        ? (await prisma.bomLine.count({ where: { phaseId: scope.id } })) > 0
        : scope.kind === "board"
          ? (await prisma.bomLine.count({ where: { boardId: scope.id } })) > 0
          : scope.kind === "item" &&
            (await prisma.bomLine.count({ where: { phase: { itemId: scope.id } } })) > 0,
    nre: await nreFor(scope, boardIds),
    // Same rule the write paths enforce — see canEditBudget.
    canEdit: await canEditBudget(scope, session),
    commitments: commitments.map((c) => ({
      id: c.id,
      itemId: c.itemId,
      itemName: c.item.name,
      attachments: c.attachments,
      category: c.category,
      amount: c.amount,
      currency: c.currency,
      originalAmount: c.originalAmount,
      fxRate: Number(c.fxRate),
      vendor: c.vendor ?? "",
      poNumber: c.poNumber ?? "",
      expectedDate: c.expectedDate,
      settled: c.settled,
      note: c.note ?? "",
    })),
    expenses: expenses.map((e) => ({
      id: e.id,
      itemId: e.itemId,
      itemName: e.item.name,
      attachments: e.attachments,
      category: e.category,
      amount: e.amount,
      currency: e.currency,
      originalAmount: e.originalAmount,
      fxRate: Number(e.fxRate),
      date: e.date,
      vendor: e.vendor ?? "",
      note: e.note ?? "",
    })),
  };
}

/**
 * 誰可以編預算:管理員、專案建立者、以及該分組的 Team Leader。
 *
 * Deliberately narrower than 結構權限 — a SUPERVISOR can reshape a board
 * without being answerable for its money, and approving spend is a different
 * kind of authority from rearranging tasks.
 *
 * 專案建立者 means the board's owner for a phase budget, and the person who
 * created the 專案群組 for a programme budget. Groups created before that
 * field existed have no creator, so those fall back to admins only.
 */
export async function canEditBudget(
  scope: BudgetScope,
  session: Awaited<ReturnType<typeof requireSession>>
): Promise<boolean> {
  // 整個專案是各階段的合計,連管理者都沒有地方可以寫——放在管理者的捷徑之前。
  if (scope.kind === "board") return false;
  if (session.role === "ADMIN") return true;

  if (scope.kind === "phase") {
    const phase = await prisma.budgetPhase.findUnique({
      where: { id: scope.id },
      select: { boardId: true, board: { select: { ownerId: true } } },
    });
    if (!phase) return false;
    if (phase.board.ownerId === session.userId) return true;
    // 階段不屬於某一個分組 —— 它橫跨整塊看板,所以問的是這塊看板上任一分組
    // 的 Team Leader。
    const groups = await prisma.group.findMany({
      where: { boardId: phase.boardId },
      select: { id: true },
    });
    return hasTeamLeaderRole(
      groups.map((g) => g.id),
      session.userId
    );
  }

  if (scope.kind === "item") {
    const item = await prisma.item.findUnique({
      where: { id: scope.id },
      select: { groupId: true, board: { select: { ownerId: true } } },
    });
    if (!item) return false;
    if (item.board.ownerId === session.userId) return true;
    return hasTeamLeaderRole([item.groupId], session.userId);
  }

  const program = await prisma.program.findUnique({
    where: { id: scope.id },
    select: {
      createdById: true,
      boards: { where: { deletedAt: null }, select: { id: true, ownerId: true } },
    },
  });
  if (!program) return false;
  if (program.createdById === session.userId) return true;
  if (program.boards.some((b) => b.ownerId === session.userId)) return true;

  const groups = await prisma.group.findMany({
    where: { boardId: { in: program.boards.map((b) => b.id) } },
    select: { id: true },
  });
  return hasTeamLeaderRole(groups.map((g) => g.id), session.userId);
}

async function hasTeamLeaderRole(groupIds: string[], userId: string): Promise<boolean> {
  if (groupIds.length === 0) return false;
  const count = await prisma.groupRoleAssignment.count({
    where: { groupId: { in: groupIds }, userId, role: "TEAM_LEADER" },
  });
  return count > 0;
}

export async function requireBudgetAdmin(scope: BudgetScope) {
  const session = await requireSession();
  const resolved = await resolveScope(scope, session);
  if (!resolved) throw new UserError("找不到這個預算範圍");
  if (!(await canEditBudget(scope, session))) {
    throw new UserError("權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯預算");
  }
  return { session, resolved };
}

/** Sets (or clears, with 0) one category's approved amount. */
export async function setBudget(
  scope: BudgetScope,
  category: CostCategory,
  amount: number,
  note: string
): Promise<{ error?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  if (!Number.isFinite(amount) || amount < 0) return { error: "預算金額必須是 0 或正數" };
  const value = Math.round(amount);

  const where = budgetWhereUnique(scope, category);
  const key = scopeKey(scope);

  const before = await prisma.budget.findUnique({ where });
  if (value === 0) {
    await prisma.budget.deleteMany({ where: { ...key, category } });
  } else {
    await prisma.budget.upsert({
      where,
      create: { ...key, category, amount: value, note: note.trim() || null, createdById: session.userId },
      update: { amount: value, note: note.trim() || null },
    });
  }

  await logAudit(
    "COST",
    session.userId,
    `${resolved.name} 的${category}預算:${before?.amount ?? 0} → ${value} 元`
  );
  revalidateBudget(scope);
  return {};
}

/**
 * 把這個階段的 NRE 報價帶入核准預算(「各類別」表的「帶入」與「全部帶入」)。
 *
 * 只有單一階段能帶入(整個專案是各階段的合計)。報價金額與哪些類別不能帶入(人力有人力規劃表、
 * 材料有樣機 BOM 算的那一格)都由伺服器照資料庫重算,不信畫面送來的數字;只處理 categories 裡指定的。
 * 帶入的核准預算備註寫「由 NRE 報價單帶入」,稽核軌跡留下每一類改之前與改之後。之後報價單再改,
 * 核准預算不會自己跟著動——要再帶入一次(那一格的報價跟核准預算不同時,「帶入」會再出現)。
 */
export async function applyNreToBudget(
  scope: BudgetScope,
  categories: CostCategory[]
): Promise<{ error?: string } & Partial<NreApplyPlan>> {
  if (scope.kind !== "phase") return { error: "請選單一階段:整個專案是各階段的合計,沒有自己的預算可以設定" };
  const { session, resolved } = await requireBudgetAdmin(scope);

  const [groups, budgets, labourCount, bomCount] = await Promise.all([
    prisma.nreLine.groupBy({ by: ["category"], where: { phaseId: scope.id }, _sum: { amount: true } }),
    prisma.budget.findMany({ where: { phaseId: scope.id }, select: { category: true, amount: true } }),
    prisma.labourPlan.count({ where: { phaseId: scope.id } }),
    prisma.bomLine.count({ where: { phaseId: scope.id } }),
  ]);
  const plan = planNreApply({
    nreByCategory: nreByCostCategory(groups.map((g) => ({ category: g.category, amount: g._sum.amount ?? 0 }))).byCategory,
    budgetByCategory: Object.fromEntries(budgets.map((b) => [b.category, b.amount])),
    labourFromPlan: labourCount > 0,
    materialFromBom: bomCount > 0,
  });
  const wanted = new Set(categories);
  const apply = plan.apply.filter((a) => wanted.has(a.category));
  const skipped = plan.skipped.filter((s) => wanted.has(s.category));
  if (apply.length === 0) return { apply, skipped };

  await prisma.$transaction(
    apply.map((a) =>
      prisma.budget.upsert({
        where: { phaseId_category: { phaseId: scope.id, category: a.category } },
        create: { phaseId: scope.id, category: a.category, amount: a.after, note: "由 NRE 報價單帶入", createdById: session.userId },
        update: { amount: a.after, note: "由 NRE 報價單帶入" },
      })
    )
  );
  await logAudit(
    "COST",
    session.userId,
    `${resolved.name} 把 NRE 報價帶入核准預算:${apply.map((a) => `${a.category} ${a.before} → ${a.after}`).join("、")} 元`
  );
  revalidateBudget(scope);
  return { apply, skipped };
}

export async function addCommitment(
  scope: BudgetScope,
  input: {
    itemId: string;
    category: CostCategory;
    /** 報價單上的金額,幣別由 currency 決定。 */
    amount: number;
    currency: string;
    fxRate: number;
    vendor: string;
    poNumber: string;
    expectedDate: string | null;
    note: string;
  }
): Promise<{ error?: string; id?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  if (!resolved.itemIds.includes(input.itemId)) return { error: "這個工作項不屬於本預算範圍" };
  const money = toMoney({
    currency: input.currency,
    originalAmount: input.amount,
    fxRate: input.fxRate,
  });
  if (!money) return { error: "金額與匯率都必須大於 0,幣別請用三個字母的代碼" };

  const created = await prisma.commitment.create({
    data: {
      itemId: input.itemId,
      category: input.category,
      amount: money.amount,
      currency: money.currency,
      originalAmount: money.originalAmount,
      fxRate: money.fxRate,
      vendor: input.vendor.trim() || null,
      poNumber: input.poNumber.trim() || null,
      expectedDate: input.expectedDate || null,
      note: input.note.trim() || null,
      createdById: session.userId,
    },
  });
  await logAudit(
    "COST",
    session.userId,
    `${resolved.name} 新增已下單:${money.amount} 元${
      isBaseCurrency(money.currency) ? "" : `(${money.currency} ${money.originalAmount} @ ${money.fxRate})`
    }${input.vendor ? `(${input.vendor})` : ""}`
  );
  revalidateBudget(scope);
  return { id: created.id };
}

/**
 * 入帳:a PO whose invoice has arrived stops being a commitment and becomes an
 * expense. Done in one step so the money cannot briefly appear twice — or,
 * worse, in neither place.
 */
export async function settleCommitment(
  scope: BudgetScope,
  commitmentId: string,
  actualAmount: number,
  date: string
): Promise<{ error?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  const commitment = await prisma.commitment.findUnique({ where: { id: commitmentId } });
  if (!commitment) return { error: "找不到這筆訂單" };
  if (commitment.settled) return { error: "這筆已經入帳了" };
  if (!resolved.itemIds.includes(commitment.itemId)) return { error: "這筆不屬於本預算範圍" };
  if (!Number.isFinite(actualAmount) || actualAmount <= 0) return { error: "入帳金額必須大於 0" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "請選擇入帳日期" };

  const amount = Math.round(actualAmount);
  await prisma.$transaction([
    prisma.expense.create({
      data: {
        itemId: commitment.itemId,
        category: commitment.category,
        amount,
        date,
        vendor: commitment.vendor,
        note: commitment.poNumber ? `PO ${commitment.poNumber} 入帳` : "訂單入帳",
        commitmentId: commitment.id,
        createdById: session.userId,
      },
    }),
    prisma.commitment.update({
      where: { id: commitmentId },
      data: { settled: true, settledAt: new Date() },
    }),
  ]);

  await logAudit(
    "COST",
    session.userId,
    `${resolved.name} 訂單入帳:${commitment.amount} → 實際 ${amount} 元${
      commitment.poNumber ? `(PO ${commitment.poNumber})` : ""
    }`
  );
  revalidateBudget(scope);
  return {};
}

export async function deleteCommitment(
  scope: BudgetScope,
  commitmentId: string
): Promise<{ error?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  const commitment = await prisma.commitment.findUnique({ where: { id: commitmentId } });
  if (!commitment || !resolved.itemIds.includes(commitment.itemId)) {
    return { error: "找不到這筆訂單" };
  }
  if (commitment.settled) return { error: "已入帳的訂單不能刪除——那是一筆帳了。" };

  await prisma.commitment.delete({ where: { id: commitmentId } });
  await logAudit("COST", session.userId, `${resolved.name} 刪除未入帳訂單:${commitment.amount} 元`);
  revalidateBudget(scope);
  return {};
}

export async function addExpense(
  scope: BudgetScope,
  input: {
    itemId: string;
    category: CostCategory;
    amount: number;
    currency: string;
    fxRate: number;
    date: string;
    vendor: string;
    note: string;
  }
): Promise<{ error?: string; id?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  if (!resolved.itemIds.includes(input.itemId)) return { error: "這個工作項不屬於本預算範圍" };
  const money = toMoney({
    currency: input.currency,
    originalAmount: input.amount,
    fxRate: input.fxRate,
  });
  if (!money) return { error: "金額與匯率都必須大於 0,幣別請用三個字母的代碼" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "請選擇日期" };
  if (input.category === "LABOUR") {
    return { error: "人力成本由核准過的工時自動計算,不要在這裡重複登記。" };
  }

  const created = await prisma.expense.create({
    data: {
      itemId: input.itemId,
      category: input.category,
      amount: money.amount,
      currency: money.currency,
      originalAmount: money.originalAmount,
      fxRate: money.fxRate,
      date: input.date,
      vendor: input.vendor.trim() || null,
      note: input.note.trim() || null,
      createdById: session.userId,
    },
  });
  await logAudit(
    "COST",
    session.userId,
    `${resolved.name} 新增支出:${money.amount} 元${
      isBaseCurrency(money.currency) ? "" : `(${money.currency} ${money.originalAmount} @ ${money.fxRate})`
    }${input.vendor ? `(${input.vendor})` : ""}`
  );
  revalidateBudget(scope);
  return { id: created.id };
}

export async function deleteExpense(
  scope: BudgetScope,
  expenseId: string
): Promise<{ error?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense || !resolved.itemIds.includes(expense.itemId)) return { error: "找不到這筆支出" };
  // Deleting the expense a PO settled into would leave the PO marked settled
  // with its money nowhere — reopen it instead.
  if (expense.commitmentId) {
    return { error: "這筆是訂單入帳產生的,不能單獨刪除。" };
  }

  await prisma.expense.delete({ where: { id: expenseId } });
  await logAudit("COST", session.userId, `${resolved.name} 刪除支出:${expense.amount} 元`);
  revalidateBudget(scope);
  return {};
}

function revalidateBudget(scope: BudgetScope) {
  if (scope.kind === "program") revalidatePath(`/programs/${scope.id}`);
  revalidatePath("/dashboard");
}

/** 20MB, the same ceiling the item attachments use. */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * 憑證 — a quote, an invoice, the signed PO.
 *
 * Stored exactly like an item attachment, under the item the cost is booked
 * to, so the existing download route keeps checking board access the same way
 * and the file lands in the same volume the backup script already covers.
 */
export async function uploadBudgetAttachment(
  scope: BudgetScope,
  target: { expenseId?: string; commitmentId?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);

  const itemId = target.expenseId
    ? (await prisma.expense.findUnique({ where: { id: target.expenseId }, select: { itemId: true } }))
        ?.itemId
    : target.commitmentId
      ? (
          await prisma.commitment.findUnique({
            where: { id: target.commitmentId },
            select: { itemId: true },
          })
        )?.itemId
      : undefined;
  if (!itemId) return { error: "找不到這筆紀錄" };
  if (!resolved.itemIds.includes(itemId)) return { error: "這筆不屬於本預算範圍" };

  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) return { error: "請選擇檔案" };
  if (file.size > MAX_FILE_SIZE) return { error: "檔案過大,請使用小於 20MB 的檔案" };

  const safeName = file.name.replace(/[/\\]/g, "_");
  const storedName = `${Date.now()}-${safeName}`;
  const dir = path.join(process.cwd(), "public", "uploads", itemId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, storedName), Buffer.from(await file.arrayBuffer()));

  await prisma.attachment.create({
    data: {
      itemId,
      expenseId: target.expenseId ?? null,
      commitmentId: target.commitmentId ?? null,
      fileName: file.name,
      url: `/uploads/${itemId}/${storedName}`,
      size: file.size,
      uploaderId: session.userId,
    },
  });

  await logAudit("COST", session.userId, `${resolved.name} 上傳憑證「${file.name}」`);
  revalidateBudget(scope);
  return {};
}

export async function deleteBudgetAttachment(
  scope: BudgetScope,
  attachmentId: string
): Promise<{ error?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || !resolved.itemIds.includes(attachment.itemId)) {
    return { error: "找不到這個檔案" };
  }
  if (!attachment.expenseId && !attachment.commitmentId) {
    return { error: "這是工作項的附件,請到該工作項刪除。" };
  }

  await prisma.attachment.delete({ where: { id: attachmentId } });
  // The row is gone either way; a file left on disk is tidier than a row
  // pointing at a file that is not there.
  await unlink(path.join(process.cwd(), "public", attachment.url)).catch(() => {});
  await logAudit("COST", session.userId, `${resolved.name} 刪除憑證「${attachment.fileName}」`);
  revalidateBudget(scope);
  return {};
}

/** 設定(或以 0 清除)一筆準備金額度。 */
export async function setReserve(
  scope: BudgetScope,
  kind: ReserveKind,
  amount: number,
  note: string
): Promise<{ error?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  if (!Number.isFinite(amount) || amount < 0) return { error: "金額必須是 0 或正數" };
  const value = Math.round(amount);

  const where = reserveWhereUnique(scope, kind);
  const key = scopeKey(scope);

  const existing = await prisma.reserve.findUnique({ where, include: { draws: true } });
  if (value === 0) {
    // Deleting a reserve that has been drawn on would erase the record of
    // where that money went — the draws are the only trace.
    if (existing?.draws.length) {
      return { error: "這筆準備金已經動支過,不能清除。要停用請把額度調到已動支的金額。" };
    }
    await prisma.reserve.deleteMany({ where: { ...key, kind } });
  } else {
    const drawn = (existing?.draws ?? []).reduce((t, d) => t + d.amount, 0);
    if (value < drawn) {
      return { error: `已經動支 ${drawn} 元,額度不能低於這個數字。` };
    }
    await prisma.reserve.upsert({
      where,
      create: { ...key, kind, amount: value, note: note.trim() || null, createdById: session.userId },
      update: { amount: value, note: note.trim() || null },
    });
  }

  await logAudit(
    "COST",
    session.userId,
    `${resolved.name} 的${kind === "CONTINGENCY" ? "應變" : "管理"}準備金:${
      existing?.amount ?? 0
    } → ${value} 元`
  );
  revalidateBudget(scope);
  return {};
}

/**
 * 動支準備金:把額度撥進一個費用類別。
 *
 * The category's approved budget goes up by the same amount in the same
 * transaction, which is what makes this a transfer rather than an invention —
 * the project's total does not change, only where the money is allowed to be
 * spent. The reason is required: why the cushion was used is the one thing
 * anybody comes back to read.
 */
export async function drawFromReserve(
  scope: BudgetScope,
  kind: ReserveKind,
  category: CostCategory,
  amount: number,
  reason: string
): Promise<{ error?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "動支金額必須大於 0" };
  const value = Math.round(amount);
  const trimmed = reason.trim();
  if (!trimmed) return { error: "動支準備金必須寫下理由——這是之後唯一查得到為什麼動用的紀錄。" };

  const where = reserveWhereUnique(scope, kind);
  const reserve = await prisma.reserve.findUnique({ where, include: { draws: true } });
  if (!reserve) return { error: "這個範圍還沒有這種準備金" };

  const remaining = reserve.amount - reserve.draws.reduce((t, d) => t + d.amount, 0);
  if (value > remaining) return { error: `準備金只剩 ${remaining} 元,不夠動支 ${value} 元。` };

  const budgetWhere = budgetWhereUnique(scope, category);
  const budgetKey = scopeKey(scope);
  const currentBudget = await prisma.budget.findUnique({ where: budgetWhere });

  await prisma.$transaction([
    prisma.reserveDraw.create({
      data: {
        reserveId: reserve.id,
        category,
        amount: value,
        reason: trimmed,
        decidedById: session.userId,
      },
    }),
    prisma.budget.upsert({
      where: budgetWhere,
      create: { ...budgetKey, category, amount: value, createdById: session.userId },
      update: { amount: (currentBudget?.amount ?? 0) + value },
    }),
  ]);

  await logAudit(
    "COST",
    session.userId,
    `${resolved.name} 動支${kind === "CONTINGENCY" ? "應變" : "管理"}準備金 ${value} 元至${category}:${trimmed}`
  );
  revalidateBudget(scope);
  return {};
}
