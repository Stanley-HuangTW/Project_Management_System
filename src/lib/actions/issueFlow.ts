"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";
import { requireIssueActor, requireIssueManager } from "@/lib/issueServer";
import {
  canConvertToRepair,
  canMoveStage,
  availableMoves,
  ISSUE_STAGE_LABELS,
  TO_REPAIR_STAGE,
  type FlowActor,
  type IssueLane,
  type IssueStage,
} from "@/lib/issueFlow";
import { notifyFlowById } from "@/lib/issueFlowServer";

async function loadForFlow(caseId: string, userId: string, role: "REPORTER" | "HANDLER" | "MANAGER") {
  const [c, me] = await Promise.all([
    prisma.issueCase.findFirst({ where: { id: caseId, deletedAt: null }, include: { assignees: { select: { userId: true } } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { issueLanes: true } }),
  ]);
  if (!c) throw new UserError("找不到這個案件(可能已經被刪除)");
  const actor: FlowActor = { issueRole: role, userId, lanes: (me?.issueLanes ?? []) as IssueLane[] };
  const facts = { assigneeIds: c.assignees.map((a) => a.userId), stage: c.stage as IssueStage, locked: c.confirmedAt !== null };
  return { c, actor, facts };
}

/** 推進或退回案件的流程階段(流程圖上的每一條線)。階段變了就寫進時間軸並通知輪到的人。 */
export async function moveIssueStage(caseId: string, to: IssueStage, note?: string): Promise<void> {
  const { role, userId } = await requireIssueActor();
  const { c, actor, facts } = await loadForFlow(caseId, userId, role);
  if (!canMoveStage(actor, facts)) throw new UserError(facts.locked ? "權限不足:案件已經結案鎖定,只有管理者可以改階段" : "權限不足:現在輪到的不是你,只有該階段的負責角色、案件負責人或管理者可以推進");
  const move = availableMoves(c.kind, facts.stage).find((m) => m.to === to);
  if (!move) throw new UserError(`從「${ISSUE_STAGE_LABELS[facts.stage]}」不能直接到「${ISSUE_STAGE_LABELS[to]}」`);
  const direction = move.direction;
  const text = typeof note === "string" ? note.trim().slice(0, 2000) : "";
  await prisma.$transaction([
    prisma.issueCase.update({ where: { id: caseId }, data: { stage: to, stageAt: new Date(), stuckNotifiedAt: null } }),
    prisma.issueLog.create({
      data: {
        caseId,
        kind: "STAGE",
        content: `${direction === "BACK" ? "退回" : "推進"}:${ISSUE_STAGE_LABELS[facts.stage]} → ${ISSUE_STAGE_LABELS[to]}${text ? `\n${text}` : ""}`,
        authorId: userId,
      },
    }),
  ]);
  await logAudit("SETTINGS", userId, `ISSUE TRACKER 案件 ${c.caseNo} 階段 ${ISSUE_STAGE_LABELS[facts.stage]} → ${ISSUE_STAGE_LABELS[to]}`);
  await notifyFlowById(caseId, { type: "STAGE", to, direction }, userId);
  revalidatePath("/issues", "layout");
}

/** Issue 轉 Repair:同一件案件改成維修類型(案號不變),落到「運送中」(流程圖:Issue 轉 Repair → 聯絡送回)。 */
export async function convertIssueToRepair(caseId: string): Promise<void> {
  const { role, userId } = await requireIssueActor();
  const { c, actor, facts } = await loadForFlow(caseId, userId, role);
  if (!canMoveStage(actor, facts)) throw new UserError("權限不足:只有目前輪到的角色、案件負責人或管理者可以轉成維修");
  if (!canConvertToRepair(c.kind, facts.stage)) throw new UserError("只有「待 Sales 判斷」或「FAE 評估」階段的問題案件可以轉成維修");
  await prisma.$transaction([
    prisma.issueCase.update({ where: { id: caseId }, data: { kind: "REPAIR", stage: TO_REPAIR_STAGE, stageAt: new Date(), stuckNotifiedAt: null } }),
    prisma.issueLog.create({ data: { caseId, kind: "STAGE", content: `Issue 轉 Repair:${ISSUE_STAGE_LABELS[facts.stage]} → ${ISSUE_STAGE_LABELS[TO_REPAIR_STAGE]}`, authorId: userId } }),
  ]);
  await logAudit("SETTINGS", userId, `ISSUE TRACKER 案件 ${c.caseNo} 由 Issue 轉 Repair`);
  await notifyFlowById(caseId, { type: "TO_REPAIR" }, userId);
  revalidatePath("/issues", "layout");
}

// ── 設定 ──────────────────────────────────────────────────────────────

/** 同一階段超過幾個工作天沒動就提醒;0 = 不提醒。 */
export async function setIssueStuckDays(days: number): Promise<void> {
  const { session } = await requireIssueManager();
  if (!Number.isInteger(days) || days < 0 || days > 60) throw new UserError("天數請填 0 到 60 的整數(0 = 不提醒)");
  await prisma.systemSettings.upsert({ where: { id: "global" }, create: { id: "global", issueStuckDays: days }, update: { issueStuckDays: days } });
  await logAudit("SETTINGS", session.userId, `ISSUE TRACKER 卡關提醒改為${days === 0 ? "不提醒" : ` ${days} 個工作天`}`);
  revalidatePath("/issues", "layout");
}

/** 流程通知(階段推進、卡關…)除了站內通知也寄 email。 */
export async function setIssueFlowEmail(enabled: boolean): Promise<void> {
  const { session } = await requireIssueManager();
  await prisma.systemSettings.upsert({ where: { id: "global" }, create: { id: "global", issueFlowEmail: !!enabled }, update: { issueFlowEmail: !!enabled } });
  await logAudit("SETTINGS", session.userId, `ISSUE TRACKER 流程通知${enabled ? "也寄 email" : "只發站內通知"}`);
  revalidatePath("/issues", "layout");
}

export type RegionFaeRow = { regionId: string; regionName: string; userIds: string[] };

/** 設定頁用:每個地區由哪些 FAE 負責,與可以選的 FAE(有 FAE 流程角色的人)。 */
export async function getRegionFaes(): Promise<{ regions: RegionFaeRow[]; faes: { id: string; name: string }[] }> {
  await requireIssueManager();
  const [regions, faes] = await Promise.all([
    prisma.issueOption.findMany({ where: { kind: "REGION", active: true }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true, regionFaes: { select: { userId: true } } } }),
    prisma.user.findMany({ where: { issueLanes: { has: "FAE" }, OR: [{ role: "ADMIN" }, { issueRole: { not: null } }] }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);
  return { regions: regions.map((r) => ({ regionId: r.id, regionName: r.name, userIds: r.regionFaes.map((f) => f.userId) })), faes };
}

/** 指定某個地區由哪些 FAE 負責(清空 = 沒有指定,案件的新案件通知給全部 FAE)。 */
export async function setRegionFaes(regionId: string, userIds: string[]): Promise<void> {
  const { session } = await requireIssueManager();
  const region = await prisma.issueOption.findFirst({ where: { id: regionId, kind: "REGION" }, select: { name: true } });
  if (!region) throw new UserError("找不到這個地區");
  const ids = [...new Set(userIds)];
  const valid = await prisma.user.findMany({ where: { id: { in: ids }, issueLanes: { has: "FAE" } }, select: { id: true } });
  if (valid.length !== ids.length) throw new UserError("只能指定有「FAE」流程角色的人");
  await prisma.$transaction([
    prisma.issueRegionFae.deleteMany({ where: { regionId } }),
    prisma.issueRegionFae.createMany({ data: ids.map((userId) => ({ regionId, userId })) }),
  ]);
  await logAudit("SETTINGS", session.userId, `ISSUE TRACKER 地區「${region.name}」的 FAE 設為 ${ids.length} 人`);
  revalidatePath("/issues", "layout");
}
