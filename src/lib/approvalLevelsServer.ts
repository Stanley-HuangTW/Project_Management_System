import type { ApprovalKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  approvalProgress,
  clampLevels,
  describeApprovalProgress,
  levelLabel,
  levelsOf,
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

/**
 * 代簽關係:誰(副主管 / 勾了「可代主管簽核」的職能)可以代哪位主管簽核。
 * 看的是「他擔任可代簽職能的部門,現在的主管是誰」,所以部門換主管,代簽的對象跟著換。
 */
export async function loadDelegations(): Promise<Map<string, string[]>> {
  const rows = await prisma.orgRole.findMany({
    where: { canApprove: true, node: { headId: { not: null } } },
    select: { userId: true, node: { select: { headId: true } } },
  });
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const head = row.node.headId;
    if (!head || head === row.userId) continue;
    map.set(row.userId, [...(map.get(row.userId) ?? []), head]);
  }
  return map;
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
}): Promise<{ error?: string; complete: boolean; note: string | null; level?: number }> {
  const { kind, targetId, submitterId, approverId, configured } = args;
  const chain = managerChain(await loadSupervisorGraph(), submitterId);
  const required = requiredLevels(chain.length, configured);
  if (required <= 1) return { complete: true, note: null, level: 1 };

  const eligible = levelsOf(chain, approverId, await loadDelegations()).filter((l) => l <= required);
  if (eligible.length === 0) return { error: "權限不足:你不是這個人需要簽核的主管", complete: false, note: null };
  const steps = (await loadApprovalSteps(kind, [targetId])).get(targetId) ?? [];
  const level = eligible.find((l) => !steps.some((s) => s.level === l));
  if (level === undefined) {
    const prior = steps.find((s) => s.level === eligible[0]);
    return {
      error:
        prior?.approverId === approverId
          ? `你已經以${levelLabel(eligible[0])}的身分核准過了,等其他階的主管`
          : `${levelLabel(eligible[0])}已經有人核准過了,不用再簽`,
      complete: false,
      note: null,
    };
  }
  try {
    await prisma.approvalStep.create({ data: { kind, targetId, level, approverId } });
  } catch {
    return { error: `${levelLabel(level)}已經有人核准過了,請重新整理`, complete: false, note: null };
  }
  const all = [...steps, { level, approverId }];
  const progress = approvalProgress(chain.length, configured, all);
  if (progress.complete) return { complete: true, note: `${progress.required} 階主管都已同意`, level };
  const nameOf = await namesOf([...chain.slice(0, required), ...all.map((s) => s.approverId)]);
  return { complete: false, note: describeApprovalProgress({ chain, configured, steps: all, nameOf }), level };
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
  const [graph, stepsByTarget, delegations] = await Promise.all([
    loadSupervisorGraph(),
    loadApprovalSteps(kind, items.map((i) => i.targetId)),
    loadDelegations(),
  ]);
  const chains = new Map(items.map((i) => [i.targetId, managerChain(graph, i.submitterId)]));
  const nameOf = await namesOf([...chains.values()].flat().concat([...stepsByTarget.values()].flat().map((s) => s.approverId)));
  for (const item of items) {
    const chain = chains.get(item.targetId) ?? [];
    const steps = stepsByTarget.get(item.targetId) ?? [];
    const base = describeApprovalProgress({ chain, configured, steps, nameOf });
    if (!base) continue;
    const own = chain.indexOf(viewerId) + 1;
    const acting = own > 0 ? 0 : (levelsOf(chain, viewerId, delegations)[0] ?? 0);
    notes.set(
      item.targetId,
      own > 0 ? `${base}(你是${levelLabel(own)})` : acting > 0 ? `${base}(你可代簽${levelLabel(acting)})` : base
    );
  }
  return notes;
}
