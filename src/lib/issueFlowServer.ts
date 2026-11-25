import { prisma } from "@/lib/prisma";
import { filterInAppRecipients, notifyEmailIfNeeded } from "@/lib/notify";
import { sendMail } from "@/lib/mail";
import { mailBody } from "@/lib/appUrl";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { taipeiTodayIso } from "@/lib/timesheet";
import { issueDayModeSetting } from "@/lib/issueSettingsServer";
import { openDays } from "@/lib/issueCase";
import { audienceFor, flowMessage, isStuck, type FlowAudience, type FlowEvent, type IssueLane, type IssueStage } from "@/lib/issueFlow";

/**
 * 客服維修流程的通知(站內一定發,email 看系統設定「流程通知也寄 email」)與卡關提醒。
 * 不在 "use server" 檔案裡。通知失敗不影響流程本身。
 */

export type FlowCase = { id: string; caseNo: string; description: string; regionId: string | null; reporterId: string | null; assigneeIds: string[] };

/** 有 ISSUE TRACKER 權限的使用者才收得到:管理者(ADMIN)一律算,其他人要有 issueRole。 */
const HAS_ACCESS = { OR: [{ role: "ADMIN" as const }, { issueRole: { not: null } }] };

async function laneUserIds(lane: IssueLane, regionId: string | null): Promise<string[]> {
  // FAE 有指定負責地區的話,案件的地區有對應的 FAE 就只通知他們;沒對應(或案件沒地區)通知全部 FAE。
  if (lane === "FAE" && regionId) {
    const assigned = await prisma.issueRegionFae.findMany({ where: { regionId, user: HAS_ACCESS }, select: { userId: true } });
    if (assigned.length > 0) return assigned.map((a) => a.userId);
  }
  const users = await prisma.user.findMany({ where: { AND: [HAS_ACCESS, { issueLanes: { has: lane } }] }, select: { id: true } });
  return users.map((u) => u.id);
}

/** 把「通知對象」的描述展開成實際的人。 */
export async function resolveAudience(c: FlowCase, a: FlowAudience): Promise<string[]> {
  const ids = new Set<string>();
  if (a.assignees) c.assigneeIds.forEach((id) => ids.add(id));
  if (a.reporter && c.reporterId) ids.add(c.reporterId);
  if (a.managers) {
    const managers = await prisma.user.findMany({ where: { OR: [{ role: "ADMIN" }, { issueRole: "MANAGER" }] }, select: { id: true } });
    managers.forEach((u) => ids.add(u.id));
  }
  for (const lane of a.lanes) (await laneUserIds(lane, c.regionId)).forEach((id) => ids.add(id));
  return [...ids];
}

/**
 * 發流程通知。actorId = 做這件事的人(自己不通知自己);系統自己觸發(排程、Mantis 同步)是 null。
 * 站內通知要看管理者有沒有把「流程」類型整個關掉、對方有沒有自己關掉;email 看 issueFlowEmail 設定。
 */
export async function notifyFlow(c: FlowCase, ev: FlowEvent, actorId: string | null): Promise<void> {
  try {
    const targets = (await resolveAudience(c, audienceFor(ev))).filter((id) => id !== actorId);
    if (targets.length === 0) return;
    const summary = c.description.replace(/\s+/g, " ").trim().slice(0, 40);
    const message = flowMessage(c.caseNo, summary, ev);
    const link = `/issues/${c.id}`;

    const inApp = await filterInAppRecipients(prisma, "ISSUE_FLOW", targets);
    if (inApp.length) {
      await prisma.notification.createMany({ data: inApp.map((userId) => ({ userId, actorId, type: "ISSUE_FLOW" as const, message, link })) });
    }

    const settings = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { issueFlowEmail: true, emailNotificationsEnabled: true } });
    if (!settings?.issueFlowEmail) return;
    if (settings.emailNotificationsEnabled) {
      for (const userId of targets) await notifyEmailIfNeeded(userId, "ISSUE_FLOW", message, link);
      return;
    }
    const users = await prisma.user.findMany({ where: { id: { in: targets } }, select: { email: true } });
    for (const u of users) await sendMail(u.email, "ISSUE TRACKER 流程通知", mailBody(message, link));
  } catch {
    // 通知不能讓流程動作失敗。
  }
}

/** 用案件 id 載入通知需要的資料(動作已經寫完之後呼叫)。 */
export async function loadFlowCase(caseId: string): Promise<FlowCase | null> {
  const c = await prisma.issueCase.findFirst({
    where: { id: caseId, deletedAt: null },
    select: { id: true, caseNo: true, description: true, regionId: true, reporterId: true, assignees: { select: { userId: true } } },
  });
  return c ? { id: c.id, caseNo: c.caseNo, description: c.description, regionId: c.regionId, reporterId: c.reporterId, assigneeIds: c.assignees.map((a) => a.userId) } : null;
}

export async function notifyFlowById(caseId: string, ev: FlowEvent, actorId: string | null): Promise<void> {
  const c = await loadFlowCase(caseId);
  if (c) await notifyFlow(c, ev, actorId);
}

/**
 * 卡關提醒:案件在同一個階段待超過 issueStuckDays 個工作天(依系統設定的工作天 / 日曆天)就提醒一次,
 * 之後階段不換就不再提醒(階段一換,stuckNotifiedAt 會清掉)。由排程心跳呼叫。回傳這次提醒了幾件。
 */
export async function runIssueStuckCheck(): Promise<number> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { issueStuckDays: true } });
  const stuckDays = settings?.issueStuckDays ?? 3;
  if (stuckDays <= 0) return 0;
  // 先用日曆天粗篩(工作天一定 ≤ 日曆天),再精算,避免每次心跳都把所有開著的案件撈出來算。
  const cutoff = new Date(Date.now() - stuckDays * 24 * 3600 * 1000);
  const candidates = await prisma.issueCase.findMany({
    where: { deletedAt: null, stuckNotifiedAt: null, stage: { notIn: ["CLOSED", "CLOSING"] }, status: { not: "NA" }, stageAt: { lte: cutoff } },
    select: { id: true, caseNo: true, description: true, regionId: true, reporterId: true, stage: true, stageAt: true, assignees: { select: { userId: true } } },
    take: 200,
  });
  if (candidates.length === 0) return 0;
  const [mode, holidays] = await Promise.all([issueDayModeSetting(), listHolidays()]);
  const holidaySet = toHolidaySet(holidays);
  const today = taipeiTodayIso();
  let sent = 0;
  for (const c of candidates) {
    const stageDay = new Date(c.stageAt.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    // openDays 含頭尾,「沒動幾天」要扣掉進到這階的當天。
    const days = Math.max(0, (openDays(stageDay, today, mode, holidaySet) ?? 1) - 1);
    if (!isStuck(c.stage as IssueStage, days, stuckDays, false)) continue;
    await prisma.issueCase.update({ where: { id: c.id }, data: { stuckNotifiedAt: new Date() } });
    await notifyFlow(
      { id: c.id, caseNo: c.caseNo, description: c.description, regionId: c.regionId, reporterId: c.reporterId, assigneeIds: c.assignees.map((a) => a.userId) },
      { type: "STUCK", stage: c.stage as IssueStage, days },
      null
    );
    sent++;
  }
  return sent;
}
