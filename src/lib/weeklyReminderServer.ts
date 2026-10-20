import { prisma } from "@/lib/prisma";
import { sendMailChecked } from "@/lib/mail";
import { buildReminderMail, reminderWeekKey, reminderWindow } from "@/lib/weeklyReminder";

/**
 * 週報排程前的提醒信:排程心跳(weekly-report-tick,每五分鐘一次)每次都會問這一支,
 * 它自己判斷現在是不是落在「下一次週報產生的前 N 小時」、這一輪寄過了沒。
 *
 * 寄給所有有帳號的同仁(使用者管理裡的每個人)——要更新工作事項的是各單位的人,不只是週報的收件人。
 * 預設不提醒(0 小時),管理者在系統設定打開。
 */

export type ReminderSettings = {
  weeklyReportEnabled: boolean;
  weeklyReportDow: number;
  weeklyReportHour: number;
  weeklyReportMinute: number;
  weeklyReportRangeStartDow: number;
  weeklyReportRangeEndDow: number;
  weeklyReportLastRunWeek: string | null;
  weeklyReportReminderHours: number;
  weeklyReportReminderLastWeek: string | null;
};

export type ReminderOutcome = { sent: boolean; reason?: string; week?: string; mailed?: number; failed?: number };

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export async function sendWeeklyReportReminder(settings: ReminderSettings, now = new Date()): Promise<ReminderOutcome> {
  if (!settings.weeklyReportEnabled) return { sent: false, reason: "排程未啟用" };
  const hours = settings.weeklyReportReminderHours;
  if (!(hours > 0)) return { sent: false, reason: "沒有設定提醒" };

  const { triggerAt, due } = reminderWindow(
    new Date(now.getTime() + TAIPEI_OFFSET_MS),
    { dow: settings.weeklyReportDow, hour: settings.weeklyReportHour, minute: settings.weeklyReportMinute },
    hours
  );
  if (!due) return { sent: false, reason: "還沒到提醒時間" };

  const week = reminderWeekKey(triggerAt);
  if (settings.weeklyReportReminderLastWeek === week) return { sent: false, reason: "這一輪已經提醒過了", week };

  // 週報根本不會寄的話(沒有任何專案設定收件人),「週報將於何時產生」就是假話。
  const subscribed = await prisma.programReportSubscription.count({ where: { recipients: { some: {} } } });
  if (subscribed === 0) return { sent: false, reason: "沒有任何專案設定週報收件人", week };

  // 條件式 updateMany 當原子鎖,跟週報本身一樣:NULL 要明講,SQL 的 <> 比對不到 NULL。
  const claimed = await prisma.systemSettings.updateMany({
    where: { id: "global", OR: [{ weeklyReportReminderLastWeek: null }, { weeklyReportReminderLastWeek: { not: week } }] },
    data: { weeklyReportReminderLastWeek: week },
  });
  if (claimed.count === 0) return { sent: false, reason: "被搶先寄過了", week };

  const users = await prisma.user.findMany({ select: { email: true } });
  const emails = [...new Set(users.map((u) => u.email).filter((e): e is string => !!e))];
  const { subject, text } = buildReminderMail({
    triggerAt,
    hours,
    range: { startDow: settings.weeklyReportRangeStartDow, endDow: settings.weeklyReportRangeEndDow },
    baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  });

  let mailed = 0;
  let failed = 0;
  for (const email of emails) {
    const result = await sendMailChecked(email, subject, text);
    if (result.ok) mailed++;
    else failed++;
  }

  // 一封都沒寄出去(信箱沒設定、SMTP 暫時掛掉)就把這一輪放回「還沒寄」,下一次心跳再試——
  // 不然整輪提醒就這樣無聲無息地沒了。有寄出去幾封就不重來,免得有人收到兩封。
  if (mailed === 0 && failed > 0) {
    await prisma.systemSettings.updateMany({
      where: { id: "global", weeklyReportReminderLastWeek: week },
      data: { weeklyReportReminderLastWeek: settings.weeklyReportReminderLastWeek },
    });
  }
  return { sent: mailed > 0, week, mailed, failed };
}
