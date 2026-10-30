import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { canAccessBoard } from "@/lib/boardAccess";
import { budgetViewableBoardIds } from "@/lib/budgetAccessServer";
import { effectiveRateMap } from "@/lib/labourRate";
import {
  summarizeBudget,
  summarizeReserves,
  alertLevel,
  type BudgetAlertLevel,
} from "@/lib/budget";

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
  /** 成本基準之外還剩多少緩衝 — what turns 已超支 into 動用準備金. */
  reserveRemaining: number;
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
      phaseId: true,
      itemId: true,
      programId: true,
      category: true,
      amount: true,
      phase: {
        select: {
          name: true,
          boardId: true,
          itemId: true,
          board: { select: { name: true } },
        },
      },
      item: { select: { name: true, boardId: true, board: { select: { name: true } } } },
      program: { select: { name: true, boards: { where: { deletedAt: null }, select: { id: true } } } },
    },
  });
  if (budgets.length === 0) return [];

  // Grouped by the thing the budget is approved for, since a scope is over
  // or not as a whole — one category being tight is a row in the table, not
  // an alert of its own.
  const byScope = new Map<string, typeof budgets>();
  for (const budget of budgets) {
    const key = budget.phaseId
      ? `f:${budget.phaseId}`
      : budget.itemId
        ? `i:${budget.itemId}`
        : `p:${budget.programId}`;
    byScope.set(key, [...(byScope.get(key) ?? []), budget]);
  }

  // 看得到看板不等於看得到預算:只有管理者、看板擁有者、專案負責角色、被指名的人與指定組織的主管看得到預算警示。
  const mentioned = new Set<string>();
  for (const b of budgets) {
    if (b.phase) mentioned.add(b.phase.boardId);
    if (b.item) mentioned.add(b.item.boardId);
    for (const board of b.program?.boards ?? []) mentioned.add(board.id);
  }
  const viewable = await budgetViewableBoardIds([...mentioned], session);

  const alerts: BudgetAlert[] = [];
  for (const [key, rows] of byScope) {
    // f = 預算階段、i = 看板上的一列、p = 專案群組。
    const kind = key[0] as "f" | "i" | "p";
    const id = key.slice(2);

    let itemIds: string[];
    let scopeName: string;
    let boardName: string | null = null;
    let href: string;

    if (kind === "f") {
      const phase = rows[0].phase;
      if (!phase) continue;
      if (!viewable.has(phase.boardId) || !(await canAccessBoard(session, phase.boardId))) continue;
      // 花費記在看板的工作項上,所以只有對應過去的階段算得出實際數字。沒
      // 對應的階段實際是 0,一定算不到警示線,自然不會出現在這張清單上。
      itemIds = phase.itemId ? await subtreeIds(phase.boardId, phase.itemId) : [];
      scopeName = phase.name;
      boardName = phase.board.name;
      href = `/boards/${phase.boardId}`;
    } else if (kind === "i") {
      const phase = rows[0].item;
      if (!phase) continue;
      if (!viewable.has(phase.boardId) || !(await canAccessBoard(session, phase.boardId))) continue;
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
        if (viewable.has(board.id) && (await canAccessBoard(session, board.id))) boardIds.push(board.id);
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

    const [expenses, commitments, entries, reserveRows] = await Promise.all([
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
      // The same scope the budget rows came from — a reserve is approved
      // alongside the budget, not spread across the subtree.
      prisma.reserve.findMany({
        where: kind === "f" ? { phaseId: id } : kind === "i" ? { itemId: id } : { programId: id },
        include: { draws: { select: { amount: true } } },
      }),
    ]);

    let labour = 0;
    if (entries.length > 0) {
      const rate = await effectiveRateMap();
      labour = entries.reduce((t, e) => t + Number(e.hours) * (rate.get(e.userId) ?? 0), 0);
    }

    const summary = summarizeBudget({
      budgets: rows.map((r) => ({ category: r.category, amount: r.amount })),
      actuals: [...expenses, { category: "LABOUR" as const, amount: Math.round(labour) }],
      commitments,
    });
    const reserves = summarizeReserves(
      reserveRows.map((r) => ({ kind: r.kind, amount: r.amount })),
      reserveRows.flatMap((r) => r.draws.map((d) => ({ kind: r.kind, amount: d.amount })))
    );
    // Passed through, or this page would call a phase 已超支 while the budget
    // page next to it says the cushion still covers it.
    const level = alertLevel(summary, 80, reserves.totalRemaining);
    if (level === "none") continue;

    alerts.push({
      href,
      scopeName,
      scopeKind: kind === "p" ? "專案群組" : "階段",
      boardName,
      level,
      budget: summary.total.budget,
      actual: summary.total.actual,
      committed: summary.total.committed,
      remaining: summary.total.remaining,
      usedPct: summary.total.usedPct,
      reserveRemaining: reserves.totalRemaining,
    });
  }

  // Worst first: past the cushion, then into the cushion, then merely close.
  const severity: Record<BudgetAlert["level"], number> = { over: 0, reserve: 1, warning: 2 };
  return alerts.sort(
    (a, b) => severity[a.level] - severity[b.level] || (b.usedPct ?? 0) - (a.usedPct ?? 0)
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
