import { prisma } from "@/lib/prisma";
import { sendMailChecked } from "@/lib/mail";
import { buildReminderMail, programsByRecipient, reminderWeekKey, reminderWindow } from "@/lib/weeklyReminder";

/**
 * 週報排程前的提醒信:排程心跳(weekly-report-tick,每五分鐘一次)每次都會問這一支,
 * 它自己判斷現在是不是落在「下一次週報產生的前 N 小時」、這一輪寄過了沒。
 *
 * 只寄給「會寄週報的專案」的成員——要更新工作事項的是專案裡的人,不是系統裡每一個帳號。
 * 專案成員 = 專案底下看板的擁有者、看板成員、看板與分組的角色(Team Leader、DM、PMD…)、分組成員。
 * 只是被指派到某個工作項、卻不在上面這些名單裡的人,不算專案成員,不會收到。
 * 同時在好幾個專案的人只收一封,信裡列出他所有的專案。
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

/** 每個「有設定週報收件人」的專案群組,以及它底下的成員(使用者 id)。 */
async function loadSubscribedProgramMembers(): Promise<{ name: string; userIds: Set<string> }[]> {
  const programs = await prisma.program.findMany({
    where: { reportSubscription: { is: { recipients: { some: {} } } } },
    orderBy: { name: "asc" },
    select: {
      name: true,
      boards: {
        where: { deletedAt: null },
        select: {
          id: true,
          ownerId: true,
          members: { select: { userId: true } },
          roleAssignments: { select: { userId: true } },
          groups: { select: { members: { select: { userId: true } }, roleAssignments: { select: { userId: true } } } },
        },
      },
    },
  });
  return programs.map((program) => {
    const userIds = new Set<string>();
    for (const board of program.boards) {
      userIds.add(board.ownerId);
      for (const m of board.members) userIds.add(m.userId);
      for (const r of board.roleAssignments) userIds.add(r.userId);
      for (const g of board.groups) {
        for (const m of g.members) userIds.add(m.userId);
        for (const r of g.roleAssignments) userIds.add(r.userId);
      }
    }
    return { name: program.name, userIds };
  });
}

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

  // 要提醒的人:會寄週報的專案的成員。先算出來再搶鎖——沒有人可以提醒就不要把這一輪標成寄過了。
  const programs = await loadSubscribedProgramMembers();
  const memberIds = [...new Set(programs.flatMap((p) => [...p.userIds]))];
  const users = memberIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: memberIds } }, select: { id: true, email: true } }) : [];
  const emailOf = new Map(users.flatMap((u) => (u.email ? [[u.id, u.email] as const] : [])));
  const recipients = programsByRecipient(programs, emailOf);
  if (recipients.size === 0) return { sent: false, reason: "會寄週報的專案裡沒有可以提醒的成員", week };

  // 條件式 updateMany 當原子鎖,跟週報本身一樣:NULL 要明講,SQL 的 <> 比對不到 NULL。
  const claimed = await prisma.systemSettings.updateMany({
    where: { id: "global", OR: [{ weeklyReportReminderLastWeek: null }, { weeklyReportReminderLastWeek: { not: week } }] },
    data: { weeklyReportReminderLastWeek: week },
  });
  if (claimed.count === 0) return { sent: false, reason: "被搶先寄過了", week };

  let mailed = 0;
  let failed = 0;
  for (const [email, programNames] of recipients) {
    const { subject, text } = buildReminderMail({
      triggerAt,
      hours,
      range: { startDow: settings.weeklyReportRangeStartDow, endDow: settings.weeklyReportRangeEndDow },
      baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
      programNames,
    });
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
