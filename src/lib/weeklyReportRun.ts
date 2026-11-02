import { prisma } from "@/lib/prisma";
import { buildProgramWeeklyReportData } from "@/lib/weeklyReportServer";
import { deliverProgramReport } from "@/lib/weeklyReportDelivery";
import type { ProgramRunResult } from "@/lib/weeklyReport";

/**
 * 專案週報分發:對每個有訂閱的專案群組產生一份週報,寄給它的收件人。
 * 排程心跳(weekly-report-tick)與系統設定的「立即執行一次」共用這一支,走的是同一條路。
 */
export async function deliverProgramReports(target: string): Promise<ProgramRunResult[]> {
  const subscriptions = await prisma.programReportSubscription.findMany({
    include: { program: { select: { name: true } }, recipients: { include: { user: { select: { email: true } } } } },
  });

  const results: ProgramRunResult[] = [];
  for (const sub of subscriptions) {
    const emails = [...new Set(sub.recipients.map((r) => r.user?.email ?? r.email).filter((e): e is string => !!e))];
    if (emails.length === 0) {
      results.push({ programName: sub.program.name, sent: 0, failed: 0, detail: "沒有收件人" });
      continue;
    }

    // 一個專案失敗不該讓其他專案也收不到——記下來、繼續下一個。
    try {
      const report = await buildProgramWeeklyReportData(sub.programId, target, {
        upcomingDays: sub.upcomingDays,
        includeBudget: sub.includeBudget,
        include: {
          summary: sub.includeSummary,
          programs: sub.includeProgramDiff,
          departments: sub.includeDepartments,
          activity: sub.includeActivity,
        },
      });
      if (!report) {
        results.push({ programName: sub.program.name, sent: 0, failed: 0, detail: "這個專案群組底下沒有看板" });
        continue;
      }
      const delivery = await deliverProgramReport(report.programName, report.snapshot, report.markdown, emails);
      results.push({
        programName: sub.program.name,
        sent: delivery.mail.filter((m) => m.ok).length,
        failed: delivery.mail.filter((m) => !m.ok).length,
        detail: delivery.mail.find((m) => !m.ok)?.reason,
      });
    } catch (err) {
      results.push({
        programName: sub.program.name,
        sent: 0,
        failed: emails.length,
        detail: `產生週報時出錯:${err instanceof Error ? err.message : "未知錯誤"}`,
      });
    }
  }
  return results;
}
