import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { canAccessBoard } from "@/lib/boardAccess";
import { summarizeBudget, alertLevel, type BudgetAlertLevel } from "@/lib/budget";

export type BudgetAlert = {
  /** Where to send the reader to do something about it. */
  href: string;
  scopeName: string;
  /** 階段 or 專案群組 — the two levels a budget can be approved at. */
  scopeKind: "階段" | "專案群組";
  boardName: string | null;
  level: Exclude<BudgetAlertLevel, "none">;
  budget: number;
  actual: number;
  committed: number;
  remaining: number;
  usedPct: number | null;
};

/**
 * Every budget this person can see that is at or past its warning line.
 *
 * The point of surfacing it here is that nobody checks a budget page until
 * they already suspect something. A phase that has quietly committed 95% of
 * its material budget is exactly the thing you want to hear about before the
 * next PO, not after.
 */
export async function budgetAlerts(session: SessionPayload): Promise<BudgetAlert[]> {
  const budgets = await prisma.budget.findMany({
    select: {
      itemId: true,
      programId: true,
      category: true,
      amount: true,
      item: { select: { name: true, boardId: true, board: { select: { name: true } } } },
      program: { select: { name: true, boards: { select: { id: true } } } },
    },
  });
  if (budgets.length === 0) return [];

  // Grouped by the thing the budget is approved for, since a scope is over
  // or not as a whole — one category being tight is a row in the table, not
  // an alert of its own.
  const byScope = new Map<string, typeof budgets>();
  for (const budget of budgets) {
    const key = budget.itemId ? `i:${budget.itemId}` : `p:${budget.programId}`;
    byScope.set(key, [...(byScope.get(key) ?? []), budget]);
  }

  const alerts: BudgetAlert[] = [];
  for (const [key, rows] of byScope) {
    const isPhase = key.startsWith("i:");
    const id = key.slice(2);

    let itemIds: string[];
    let scopeName: string;
    let boardName: string | null = null;
    let href: string;

    if (isPhase) {
      const phase = rows[0].item;
      if (!phase) continue;
      if (!(await canAccessBoard(session, phase.boardId))) continue;
      // The phase row plus everything under it — the budget covers the subtree.
      itemIds = await subtreeIds(phase.boardId, id);
      scopeName = phase.name;
      boardName = phase.board.name;
      href = `/boards/${phase.boardId}`;
    } else {
      const program = rows[0].program;
      if (!program) continue;
      const boardIds: string[] = [];
      for (const board of program.boards) {
        if (await canAccessBoard(session, board.id)) boardIds.push(board.id);
      }
      // Not a single board of it is visible — from here the programme, and
      // therefore its budget, does not exist.
      if (boardIds.length === 0) continue;
      const items = await prisma.item.findMany({
        where: { boardId: { in: boardIds }, deletedAt: null },
        select: { id: true },
      });
      itemIds = items.map((i) => i.id);
      scopeName = program.name;
      href = `/programs/${id}`;
    }

    const [expenses, commitments, entries] = await Promise.all([
      prisma.expense.findMany({
        where: { itemId: { in: itemIds } },
        select: { category: true, amount: true },
      }),
      prisma.commitment.findMany({
        where: { itemId: { in: itemIds }, settled: false },
        select: { category: true, amount: true },
      }),
      prisma.timeEntry.findMany({
        where: { status: "APPROVED", itemId: { in: itemIds }, item: { deletedAt: null } },
        select: { userId: true, hours: true },
      }),
    ]);

    let labour = 0;
    if (entries.length > 0) {
      const users = await prisma.user.findMany({ select: { id: true, hourlyRate: true } });
      const rate = new Map(users.map((u) => [u.id, u.hourlyRate ? Number(u.hourlyRate) : 0]));
      labour = entries.reduce((t, e) => t + Number(e.hours) * (rate.get(e.userId) ?? 0), 0);
    }

    const summary = summarizeBudget({
      budgets: rows.map((r) => ({ category: r.category, amount: r.amount })),
      actuals: [...expenses, { category: "LABOUR" as const, amount: Math.round(labour) }],
      commitments,
    });
    const level = alertLevel(summary);
    if (level === "none") continue;

    alerts.push({
      href,
      scopeName,
      scopeKind: isPhase ? "階段" : "專案群組",
      boardName,
      level,
      budget: summary.total.budget,
      actual: summary.total.actual,
      committed: summary.total.committed,
      remaining: summary.total.remaining,
      usedPct: summary.total.usedPct,
    });
  }

  // Over budget first, then whoever is closest to the line.
  return alerts.sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === "over" ? -1 : 1) || (b.usedPct ?? 0) - (a.usedPct ?? 0)
  );
}

/** A phase row and everything beneath it. */
async function subtreeIds(boardId: string, rootId: string): Promise<string[]> {
  const all = await prisma.item.findMany({
    where: { boardId, deletedAt: null },
    select: { id: true, parentId: true },
  });
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const child of all.filter((i) => i.parentId === id)) walk(child.id);
  };
  walk(rootId);
  return out;
}
