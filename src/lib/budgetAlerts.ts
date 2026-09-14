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
      groupId: true,
      programId: true,
      category: true,
      amount: true,
      group: { select: { name: true, boardId: true, board: { select: { name: true } } } },
      program: { select: { name: true, boards: { select: { id: true } } } },
    },
  });
  if (budgets.length === 0) return [];

  // Grouped by the thing the budget is approved for, since a scope is over
  // or not as a whole — one category being tight is a row in the table, not
  // an alert of its own.
  const byScope = new Map<string, typeof budgets>();
  for (const budget of budgets) {
    const key = budget.groupId ? `g:${budget.groupId}` : `p:${budget.programId}`;
    byScope.set(key, [...(byScope.get(key) ?? []), budget]);
  }

  const alerts: BudgetAlert[] = [];
  for (const [key, rows] of byScope) {
    const isGroup = key.startsWith("g:");
    const id = key.slice(2);

    let groupIds: string[];
    let scopeName: string;
    let boardName: string | null = null;
    let href: string;

    if (isGroup) {
      const group = rows[0].group;
      if (!group) continue;
      if (!(await canAccessBoard(session, group.boardId))) continue;
      groupIds = [id];
      scopeName = group.name;
      boardName = group.board.name;
      href = `/boards/${group.boardId}`;
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
      const groups = await prisma.group.findMany({
        where: { boardId: { in: boardIds } },
        select: { id: true },
      });
      groupIds = groups.map((g) => g.id);
      scopeName = program.name;
      href = `/programs/${id}`;
    }

    const [expenses, commitments, entries] = await Promise.all([
      prisma.expense.findMany({
        where: { groupId: { in: groupIds } },
        select: { category: true, amount: true },
      }),
      prisma.commitment.findMany({
        where: { groupId: { in: groupIds }, settled: false },
        select: { category: true, amount: true },
      }),
      prisma.timeEntry.findMany({
        where: { status: "APPROVED", item: { deletedAt: null, groupId: { in: groupIds } } },
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
      scopeKind: isGroup ? "階段" : "專案群組",
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
