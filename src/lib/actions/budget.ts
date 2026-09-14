"use server";

import { revalidatePath } from "next/cache";
import type { CostCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, canAccessBoard } from "@/lib/boardAccess";
import { requireStructureAccess, canManageStructure } from "@/lib/permissions";
import { summarizeBudget, alertLevel, type BudgetSummary, type BudgetAlertLevel } from "@/lib/budget";
import { logAudit } from "@/lib/activityLog";

/** 階段(一列工作項)或整個專案群組 — the two levels a budget is approved at. */
export type BudgetScope = { kind: "item"; id: string } | { kind: "program"; id: string };

export type CommitmentRow = {
  id: string;
  itemId: string;
  itemName: string;
  category: CostCategory;
  amount: number;
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
  category: CostCategory;
  amount: number;
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
  items: { id: string; name: string; depth: number; boardName: string }[];
  commitments: CommitmentRow[];
  expenses: ExpenseRow[];
  /** 人力實際成本 is derived, not booked, so it is stated separately — it is
   *  the one line nobody can reconcile against a receipt. */
  labourActual: number;
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
    const subtree = collectSubtree(root.id, all, root.board.name);
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
      items.push(...collectSubtree(root.id, all, board.name));
    }
  }
  return { name: program.name, itemIds: items.map((i) => i.id), items };
}

/** The row plus everything beneath it, in display order, with its indent. */
function collectSubtree(
  rootId: string,
  all: { id: string; name: string; parentId: string | null }[],
  boardName: string
): BudgetView["items"] {
  const out: BudgetView["items"] = [];
  const walk = (id: string, depth: number) => {
    const node = all.find((i) => i.id === id);
    if (!node) return;
    out.push({ id: node.id, name: node.name, depth, boardName });
    for (const child of all.filter((i) => i.parentId === id)) walk(child.id, depth + 1);
  };
  walk(rootId, 0);
  return out;
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
      include: { item: { select: { name: true } } },
    }),
    prisma.expense.findMany({
      where: { itemId: { in: itemIds } },
      orderBy: { date: "desc" },
      include: { item: { select: { name: true } } },
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

  return {
    scopeName: resolved.name,
    summary,
    alert: alertLevel(summary),
    items: resolved.items,
    labourActual: Math.round(labour),
    // The same bar as every other structural change on a board.
    canEdit: canManageStructure(session.role),
    commitments: commitments.map((c) => ({
      id: c.id,
      itemId: c.itemId,
      itemName: c.item.name,
      category: c.category,
      amount: c.amount,
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
      category: e.category,
      amount: e.amount,
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
    amount: number;
    vendor: string;
    poNumber: string;
    expectedDate: string | null;
    note: string;
  }
): Promise<{ error?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  if (!resolved.itemIds.includes(input.itemId)) return { error: "這個工作項不屬於本預算範圍" };
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: "金額必須大於 0" };

  await prisma.commitment.create({
    data: {
      itemId: input.itemId,
      category: input.category,
      amount: Math.round(input.amount),
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
    `${resolved.name} 新增已下單:${Math.round(input.amount)} 元${input.vendor ? `(${input.vendor})` : ""}`
  );
  revalidateBudget(scope);
  return {};
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
    date: string;
    vendor: string;
    note: string;
  }
): Promise<{ error?: string }> {
  const { session, resolved } = await requireBudgetAdmin(scope);
  if (!resolved.itemIds.includes(input.itemId)) return { error: "這個工作項不屬於本預算範圍" };
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: "金額必須大於 0" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "請選擇日期" };
  if (input.category === "LABOUR") {
    return { error: "人力成本由核准過的工時自動計算,不要在這裡重複登記。" };
  }

  await prisma.expense.create({
    data: {
      itemId: input.itemId,
      category: input.category,
      amount: Math.round(input.amount),
      date: input.date,
      vendor: input.vendor.trim() || null,
      note: input.note.trim() || null,
      createdById: session.userId,
    },
  });
  await logAudit(
    "COST",
    session.userId,
    `${resolved.name} 新增支出:${Math.round(input.amount)} 元${input.vendor ? `(${input.vendor})` : ""}`
  );
  revalidateBudget(scope);
  return {};
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
