"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { canAccessBoard } from "@/lib/boardAccess";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { computeBoardCost, type BoardCostSummary } from "@/lib/boardCost";
import { gatherCostInputs } from "@/lib/costInputs";

export type BoardCostReport = BoardCostSummary & {
  hoursPerDay: number;
  /** People who logged hours on this board but have no rate set, so their
   *  work is currently costing zero. Named rather than counted: the fix is
   *  to go and set that person's rate. */
  missingRateNames: string[];
  /** True when nothing has a budget or an actual — the report then has
   *  nothing to show and says so instead of a wall of zeros. */
  empty: boolean;
  /** Summary rows carrying a 直接費用 budget, which the leaf rule leaves out
   *  of BAC. Reported rather than dropped in silence: somebody typed that
   *  number and is entitled to know it is not being counted. */
  ignoredParentBudgets: string[];
};

/** Today at midnight — PV is read against whole days, not the current time. */
function today(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

function toReport(
  gathered: Awaited<ReturnType<typeof gatherCostInputs>>
): BoardCostReport {
  const summary = computeBoardCost(gathered.inputs, today());
  return {
    ...summary,
    hoursPerDay: gathered.hoursPerDay,
    missingRateNames: gathered.missingRateNames,
    ignoredParentBudgets: gathered.ignoredParentBudgets,
    empty: summary.planned.total === 0 && summary.actual.total === 0,
  };
}

/** 成本與 EVM for one board. */
export async function getBoardCostReport(boardId: string): Promise<BoardCostReport> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const settings = await getSystemSettings();
  return toReport(await gatherCostInputs([boardId], session, settings.hoursPerDay));
}

/**
 * 成本與 EVM for a whole 專案群組.
 *
 * One BAC, one EV, one AC over every board in the group — which is the only
 * way the CPI means anything for a project split across three boards. Boards
 * the session cannot open are left out.
 */
export async function getProgramCostReport(programId: string): Promise<BoardCostReport> {
  const session = await requireSession();
  const boards = await prisma.board.findMany({ where: { programId, deletedAt: null }, select: { id: true } });
  const allowed: string[] = [];
  for (const board of boards) {
    if (await canAccessBoard(session, board.id)) allowed.push(board.id);
  }
  const settings = await getSystemSettings();
  return toReport(await gatherCostInputs(allowed, session, settings.hoursPerDay));
}
