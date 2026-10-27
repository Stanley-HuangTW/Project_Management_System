"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { deliverProgramReports } from "@/lib/weeklyReportRun";
import { summarizeWeeklyRun, weeklyRunPlan } from "@/lib/weeklyReport";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 立即執行一次專案週報分發:不管這一輪跑過了沒,走跟排程心跳同一條路,產生並寄給每個專案群組的收件人。
 * 寄信失敗(例如 SMTP 密碼被拒)不用等下一輪,按一次就看得到原因,結果也寫在排程卡片的「上次執行」。
 * 有寄出去才把這一輪標成跑過了,排程就不會在同一週再寄一次;全部失敗就不標,修好之後可以再按。
 */
export async function runWeeklyReportNow(): Promise<{ error?: string; note?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const settings = await getSystemSettings();
  const todayIso = new Date(Date.now() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
  const { weekKey, target } = weeklyRunPlan(todayIso, {
    startDow: settings.weeklyReportRangeStartDow,
    endDow: settings.weeklyReportRangeEndDow,
  });

  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: { id: "global", weeklyReportLastRunAt: new Date(), weeklyReportLastRunNote: `${weekKey}:手動執行中…` },
    update: { weeklyReportLastRunAt: new Date(), weeklyReportLastRunNote: `${weekKey}:手動執行中…` },
  });

  let results;
  try {
    results = await deliverProgramReports(target);
  } catch (err) {
    const note = `${weekKey}:手動執行失敗(${err instanceof Error ? err.message : "未知錯誤"})`;
    await prisma.systemSettings.update({ where: { id: "global" }, data: { weeklyReportLastRunNote: note } });
    revalidatePath("/settings");
    return { error: note };
  }

  const sent = results.reduce((sum, r) => sum + r.sent, 0);
  const note = `手動執行,${summarizeWeeklyRun(weekKey, results)}`;
  await prisma.systemSettings.update({
    where: { id: "global" },
    data: {
      weeklyReportLastRunAt: new Date(),
      weeklyReportLastRunNote: note,
      ...(sent > 0 ? { weeklyReportLastRunWeek: weekKey } : {}),
    },
  });
  await logAudit("SETTINGS", session.userId, `手動執行專案週報:${note}`);
  revalidatePath("/settings");
  return { note };
}
