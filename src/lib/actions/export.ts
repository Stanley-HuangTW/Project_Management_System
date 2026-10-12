"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { boardWithDataArgs, type UserOption } from "@/types/board";
import { buildGanttWorkbook } from "@/lib/export/ganttWorkbookExport";
import { GANTT_APPS_SCRIPT } from "@/lib/export/ganttAppsScript";
import { listHolidays } from "@/lib/holidays";
import { loadDmRestriction } from "@/lib/dmScopeServer";
import { getBudgetView } from "@/lib/actions/budget";
import { getDelayAnalysis } from "@/lib/actions/delayAnalysis";
import { CATEGORY_LABELS } from "@/lib/budget";
import type { BudgetScopeExport, DelayExport } from "@/lib/export/exportData";

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

const ALERT_LABELS: Record<string, string> = {
  none: "預算正常",
  warning: "接近上限",
  reserve: "超出成本基準,準備金可補",
  over: "已超支",
};

/**
 * 預算與燃盡曲線 for everything approved under this board: one entry per phase
 * that carries a budget, plus the 專案群組's own if the board belongs to one.
 *
 * Read through getBudgetView — the same call the budget page makes — so an
 * exported figure and the one on screen cannot disagree. A phase with nothing
 * approved and nothing spent is skipped rather than exported as a table of
 * zeros.
 */
async function gatherBudgets(boardId: string): Promise<BudgetScopeExport[]> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      programId: true,
      program: { select: { id: true, name: true } },
      items: { where: { deletedAt: null, parentId: null }, select: { id: true } },
    },
  });
  if (!board) return [];

  const scopes: BudgetScopeExport[] = [];
  const add = async (kind: string, scope: Parameters<typeof getBudgetView>[0]) => {
    const view = await getBudgetView(scope);
    if (!view) return;
    if (view.summary.noBudget && view.summary.total.actual + view.summary.total.committed === 0) {
      return;
    }
    const line = (l: (typeof view.summary.lines)[number], label: string) => ({
      label,
      budget: l.budget,
      actual: l.actual,
      committed: l.committed,
      remaining: l.remaining,
      usedPct: l.usedPct,
    });
    scopes.push({
      name: view.scopeName,
      kind,
      alert: ALERT_LABELS[view.alert] ?? view.alert,
      lines: view.summary.lines.map((l) => line(l, CATEGORY_LABELS[l.category])),
      total: line(view.summary.total, "合計"),
      reserves: [
        { label: "應變準備金", ...view.reserves.contingency },
        { label: "管理準備金", ...view.reserves.management },
      ].filter((r) => r.approved > 0 || r.drawn > 0),
      labourActual: view.labourActual,
      fractionDone: view.forecast.fractionDone,
      engaged: view.forecast.engaged,
      eacAtCurrentRate: view.forecast.eacAtCurrentRate,
      eacRemainingAtPlan: view.forecast.eacRemainingAtPlan,
      varianceAtCompletion: view.forecast.varianceAtCompletion,
      points: view.forecast.points,
    });
  };

  for (const phase of board.items) await add("階段", { kind: "item", id: phase.id });
  if (board.program) await add("專案群組", { kind: "program", id: board.program.id });
  return scopes;
}

async function gatherDelay(boardId: string): Promise<DelayExport> {
  const analysis = await getDelayAnalysis(boardId);
  return {
    projectDelay: analysis.projectDelay,
    noBaseline: analysis.noBaseline,
    culprits: analysis.culprits.map((c) => ({
      wbsCode: c.wbsCode,
      name: c.name,
      startDelta: c.startDelta,
      endDelta: c.endDelta,
      daysDelta: c.daysDelta,
      inheritedDelay: c.inheritedDelay,
      ownDelay: c.ownDelay,
      downstreamCount: c.downstreamCount,
    })),
  };
}

export async function exportGanttWorkbook(
  boardId: string,
  groupId: string,
  options: { extraColumnIds?: string[]; maxLevel?: number | null } = {}
): Promise<{ xlsxFilename: string; xlsxBase64: string; gsFilename: string; gsContent: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  // 這份 Excel 帶預算與全部工作項,不分範圍。被系統設定限制了可見範圍的 DM(即使同時是主管)不能匯出。
  if (await loadDmRestriction(boardId, session)) throw new Error("你的角色受「DM 的可見範圍」限制,不能匯出甘特圖 Excel");

  const [board, users, resources, holidays, budgets, delay] = await Promise.all([
    prisma.board.findUnique({ where: { id: boardId }, ...boardWithDataArgs }),
    prisma.user.findMany({
      select: { id: true, name: true, supervisorId: true, avatarUrl: true },
      orderBy: { name: "asc" },
    }),
    prisma.resource.findMany({ orderBy: { order: "asc" } }),
    listHolidays(),
    gatherBudgets(boardId),
    gatherDelay(boardId),
  ]);
  if (!board) throw new Error("找不到看板");

  const group = board.groups.find((g) => g.id === groupId);
  if (!group) throw new Error("找不到分組");

  // Resources (tools, external vendors) can be set as an item's 負責人
  // alongside real Users, so PERSON-column values may reference either —
  // same merged list used to render the assignee dropdown in board views.
  const assignees: UserOption[] = [
    ...users,
    ...resources.map((r) => ({
      id: r.id,
      name: r.category ? `${r.name} (${r.category})` : r.name,
      supervisorId: null,
      avatarUrl: null,
      isResource: true,
    })),
  ];

  const buffer = await buildGanttWorkbook(board, group, {
    extraColumnIds: options.extraColumnIds,
    maxLevel: options.maxLevel,
    users: assignees,
    holidays,
    budgets,
    delay,
  });
  const baseName = sanitizeFilename(`${board.name}-${group.name}-Gantt`);

  return {
    xlsxFilename: `${baseName}.xlsx`,
    xlsxBase64: buffer.toString("base64"),
    gsFilename: `${baseName}-AppsScript.gs`,
    gsContent: GANTT_APPS_SCRIPT,
  };
}
