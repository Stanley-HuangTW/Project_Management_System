import type { ApprovalKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  approvalProgress,
  clampLevels,
  describeApprovalProgress,
  levelLabel,
  managerChain,
  requiredLevels,
} from "@/lib/approvalLevels";

/** 系統設定:請假、工時的「主管這一條路」要幾階主管同意(沒設定就是 1 階 = 只要直屬主管)。 */
export async function getApprovalLevelSettings(): Promise<{ leave: number; timesheet: number }> {
  const row = await prisma.systemSettings.findUnique({
    where: { id: "global" },
    select: { leaveApprovalLevels: true, timesheetApprovalLevels: true },
  });
  return { leave: clampLevels(row?.leaveApprovalLevels ?? 1), timesheet: clampLevels(row?.timesheetApprovalLevels ?? 1) };
}

/** 整間公司的所屬主管關係(幾十筆)撈一次,之後每個人的主管鏈都在記憶體裡算。 */
export async function loadSupervisorGraph(): Promise<{ id: string; supervisorId: string | null }[]> {
  return prisma.user.findMany({ select: { id: true, supervisorId: true } });
}

export type ApprovalStepRow = { level: number; approverId: string };

export async function loadApprovalSteps(kind: ApprovalKind, targetIds: string[]): Promise<Map<string, ApprovalStepRow[]>> {
  const map = new Map<string, ApprovalStepRow[]>();
  if (targetIds.length === 0) return map;
  const rows = await prisma.approvalStep.findMany({
    where: { kind, targetId: { in: targetIds } },
    orderBy: { level: "asc" },
    select: { targetId: true, level: true, approverId: true },
  });
  for (const row of rows) map.set(row.targetId, [...(map.get(row.targetId) ?? []), { level: row.level, approverId: row.approverId }]);
  return map;
}

async function namesOf(userIds: string[]): Promise<(id: string) => string> {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true } });
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return (id) => byId.get(id) ?? "(已刪除的使用者)";
}

/**
 * 一位主管核准一筆紀錄(工時或請假)的「主管那一階」。
 * 設定只要一階(或送審者頭上沒有那麼多階主管)就不記步驟、直接算完成——跟沒有多階簽核時一模一樣。
 * 要多階的話記下這一階,再看需要的階是不是都簽齊了。各階同時送審,不用等前一階。
 */
export async function recordSupervisorApproval(args: {
  kind: ApprovalKind;
  targetId: string;
  submitterId: string;
  approverId: string;
  configured: number;
}): Promise<{ error?: string; complete: boolean; note: string | null }> {
  const { kind, targetId, submitterId, approverId, configured } = args;
  const chain = managerChain(await loadSupervisorGraph(), submitterId);
  const required = requiredLevels(chain.length, configured);
  if (required <= 1) return { complete: true, note: null };

  const level = chain.indexOf(approverId) + 1;
  if (level < 1 || level > required) return { error: "權限不足:你不是這個人需要簽核的主管", complete: false, note: null };
  const steps = (await loadApprovalSteps(kind, [targetId])).get(targetId) ?? [];
  if (steps.some((s) => s.level === level)) {
    return { error: `你已經以${levelLabel(level)}的身分核准過了,等其他階的主管`, complete: false, note: null };
  }
  try {
    await prisma.approvalStep.create({ data: { kind, targetId, level, approverId } });
  } catch {
    return { error: `${levelLabel(level)}已經有人核准過了,請重新整理`, complete: false, note: null };
  }
  const all = [...steps, { level, approverId }];
  const progress = approvalProgress(chain.length, configured, all);
  if (progress.complete) return { complete: true, note: `${progress.required} 階主管都已同意` };
  const nameOf = await namesOf([...chain.slice(0, required), ...all.map((s) => s.approverId)]);
  return { complete: false, note: describeApprovalProgress({ chain, configured, steps: all, nameOf }) };
}

/**
 * 待我審核頁每一筆底下那行進度說明(只有要多階的才有),並標出「輪到你」是哪一階。
 * 一次算一批:主管關係、已簽的步驟、姓名各撈一次。
 */
export async function approvalNotes(args: {
  kind: ApprovalKind;
  items: { targetId: string; submitterId: string }[];
  configured: number;
  viewerId: string;
}): Promise<Map<string, string>> {
  const { kind, items, configured, viewerId } = args;
  const notes = new Map<string, string>();
  if (items.length === 0 || clampLevels(configured) <= 1) return notes;
  const [graph, stepsByTarget] = await Promise.all([
    loadSupervisorGraph(),
    loadApprovalSteps(kind, items.map((i) => i.targetId)),
  ]);
  const chains = new Map(items.map((i) => [i.targetId, managerChain(graph, i.submitterId)]));
  const nameOf = await namesOf([...chains.values()].flat().concat([...stepsByTarget.values()].flat().map((s) => s.approverId)));
  for (const item of items) {
    const chain = chains.get(item.targetId) ?? [];
    const steps = stepsByTarget.get(item.targetId) ?? [];
    const base = describeApprovalProgress({ chain, configured, steps, nameOf });
    if (!base) continue;
    const mine = chain.indexOf(viewerId) + 1;
    notes.set(item.targetId, mine > 0 ? `${base}(你是${levelLabel(mine)})` : base);
  }
  return notes;
}
