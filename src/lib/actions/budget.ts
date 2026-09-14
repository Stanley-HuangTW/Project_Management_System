"use server";

import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import type { CostCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, canAccessBoard } from "@/lib/boardAccess";
import { requireStructureAccess, canManageStructure } from "@/lib/permissions";
import { summarizeBudget, alertLevel, type BudgetSummary, type BudgetAlertLevel } from "@/lib/budget";
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

/** 階段(一列工作項)或整個專案群組 — the two levels a budget is approved at. */
export type BudgetScope = { kind: "item"; id: string } | { kind: "program"; id: string };

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
  /** 照這樣下去會花多少 — see budgetForecast.ts. */
  forecast: BudgetForecast;
  /** 目前可選的幣別與匯率,用來預填輸入框。 */
  rates: { code: string; rate: number }[];
  /** 未入帳的外幣訂單,若今天全部付款會多花(或少花)多少台幣。 */
  fxExposure: ReturnType<typeof fxExposure>;
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
): Promise<{ name: string; itemIds: string[]; items: BudgetView["items"] } | null> {
  if (scope.kind === "item") {
    const root = await prisma.item.findUnique({
      where: { id: scope.id },
      select: { id: true, name: true, boardId: true, board: { select: { name: true } } },
    });
    if (!root) return null;
    await requireBoardAccess(root.boardId, session);

    const all = await prisma.item.findMany({
      where: { boardId: root.boardId, deletedAt: null },
      select: { id: true, name: true, parentId: true, order: true },
      orderBy: { order: "asc" },
    });
    const subtree = collectSubtree(root.id, all, root.boardId, root.board.name);
    return { name: root.name, itemIds: subtree.map((i) => i.id), items: subtree };
  }

  const program = await prisma.program.findUnique({
    where: { id: scope.id },
    select: { name: true, boards: { select: { id: true, name: true } } },
  });
  if (!program) return null;

  // A board the caller cannot open contributes nothing — its costs would
  // otherwise leak out as a total they were not meant to see.
  const items: BudgetView["items"] = [];
  for (const board of program.boards) {
    if (!(await canAccessBoard(session, board.id))) continue;
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
  boardIds: string[]
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
    scheduleStart: start,
    scheduleEnd: end,
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

  const users = await prisma.user.findMany({ select: { id: true, hourlyRate: true } });
  const rate = new Map(users.map((u) => [u.id, u.hourlyRate ? Number(u.hourlyRate) : 0]));
  return entries.reduce((total, e) => total + Number(e.hours) * (rate.get(e.userId) ?? 0), 0);
}

export async function getBudgetView(scope: BudgetScope): Promise<BudgetView | null> {
  const session = await requireSession();
  const resolved = await resolveScope(scope, session);
  if (!resolved) return null;
  const { itemIds } = resolved;

  const [budgets, commitments, expenses, labour] = await Promise.all([
    prisma.budget.findMany({
      where: scope.kind === "item" ? { itemId: scope.id } : { programId: scope.id },
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
    boardIds
  );

  // 匯率只用來預填輸入框,以及算未入帳外幣訂單的風險——每一筆帳用的仍然是
  // 它自己存下來的那個匯率。
  const rateRows = await prisma.exchangeRate.findMany({ select: { code: true, rate: true } });
  const currentRates = new Map(rateRows.map((r) => [r.code, Number(r.rate)]));

  return {
    scopeName: resolved.name,
    summary,
    alert: alertLevel(summary),
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
    items: resolved.items,
    labourActual: Math.round(labour),
    // The same bar as every other structural change on a board.
    canEdit: canManageStructure(session.role),
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

async function requireBudgetAdmin(scope: BudgetScope) {
  const session = await requireSession();
  const resolved = await resolveScope(scope, session);
  if (!resolved) throw new Error("找不到這個預算範圍");
  requireStructureAccess(session.role);
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

  const where =
    scope.kind === "item"
      ? { itemId_category: { itemId: scope.id, category } }
      : { programId_category: { programId: scope.id, category } };
  const key = scope.kind === "item" ? { itemId: scope.id } : { programId: scope.id };

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
