"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";
import { requireIssueActor } from "@/lib/issueServer";
import { canEditHandlingFields } from "@/lib/issueAccess";
import { canMoveStage, type IssueLane, type IssueStage } from "@/lib/issueFlow";
import { isIsoDate } from "@/lib/issueCase";
import type { IssueRepairInfo } from "@/lib/issueTypes";

function dateOrNull(v: unknown, label: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (!isIsoDate(v)) throw new UserError(`${label}的日期格式不正確`);
  return v;
}

/**
 * 儲存維修進度(送修方式、物流單號、各階段日期、配件清點、現場更換)。
 * 輪到的角色(Sales 填物流、FAE 填維修)、案件負責人與管理者可以填;案件鎖定後只有管理者。
 * 有改動就在時間軸記一筆流程紀錄。
 */
export async function saveRepairInfo(caseId: string, input: IssueRepairInfo): Promise<void> {
  const { role, userId } = await requireIssueActor();
  const [c, me] = await Promise.all([
    prisma.issueCase.findFirst({ where: { id: caseId, deletedAt: null }, include: { assignees: { select: { userId: true } } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { issueLanes: true } }),
  ]);
  if (!c) throw new UserError("找不到這個案件(可能已經被刪除)");
  const facts = { assigneeIds: c.assignees.map((a) => a.userId), stage: c.stage as IssueStage, locked: c.confirmedAt !== null };
  const actor = { issueRole: role, userId, lanes: (me?.issueLanes ?? []) as IssueLane[] };
  if (role !== "MANAGER" && facts.locked) throw new UserError("這個案件已經結案鎖定,只有管理者可以修改維修進度");
  if (!canMoveStage(actor, facts) && !canEditHandlingFields(role, userId, { reporterId: c.reporterId, assigneeIds: facts.assigneeIds, locked: facts.locked })) {
    throw new UserError("權限不足:只有目前輪到的角色、案件負責人或管理者可以填維修進度");
  }
  if (input.shipMethod !== null && input.shipMethod !== "MAIL" && input.shipMethod !== "HAND") throw new UserError("送修方式不正確");
  const trackingNo = String(input.trackingNo ?? "").trim().slice(0, 100);
  const accessories = String(input.accessories ?? "").trim().slice(0, 5000);
  const data = {
    shipMethod: input.shipMethod,
    trackingNo: trackingNo || null,
    shippedDate: dateOrNull(input.shippedDate, "送出"),
    receivedDate: dateOrNull(input.receivedDate, "收件"),
    accessories,
    onsiteReplace: !!input.onsiteReplace,
    repairStartDate: dateOrNull(input.repairStartDate, "開始維修"),
    repairDoneDate: dateOrNull(input.repairDoneDate, "維修完成"),
  };
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => (data[k] ?? null) !== ((c[k] as unknown) ?? null) && !(k === "accessories" && data.accessories === c.accessories));
  if (changed.length === 0) return;
  await prisma.$transaction([
    prisma.issueCase.update({ where: { id: caseId }, data }),
    prisma.issueLog.create({ data: { caseId, kind: "STAGE", content: "更新維修進度(送修 / 收件 / 配件清點 / 維修日期)", authorId: userId } }),
  ]);
  await logAudit("SETTINGS", userId, `ISSUE TRACKER 案件 ${c.caseNo} 更新維修進度`);
  revalidatePath("/issues", "layout");
}
