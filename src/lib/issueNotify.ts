import { prisma } from "@/lib/prisma";
import { filterInAppRecipients, notifyEmailIfNeeded } from "@/lib/notify";
import { sendMail } from "@/lib/mail";
import { mailBody } from "@/lib/appUrl";

/**
 * 案件指派給人時通知對方:一定發站內通知(管理者沒把「指派」類型整個關掉、對方沒自己關掉的話);
 * 要不要另外寄 email 看系統設定「ISSUE TRACKER 指派寄信」(預設關,還要 SMTP 有設定)。
 * 寄信失敗不影響指派本身。不在 "use server" 檔案裡。
 */
export async function notifyIssueAssigned(
  c: { id: string; caseNo: string; description: string },
  userIds: string[],
  actorId: string
): Promise<void> {
  const targets = [...new Set(userIds)].filter((id) => id !== actorId);
  if (targets.length === 0) return;
  const link = `/issues/${c.id}`;
  const summary = c.description.replace(/\s+/g, " ").trim().slice(0, 40);
  const message = `你被指派了案件 ${c.caseNo}${summary ? `:${summary}` : ""}`;

  const inApp = await filterInAppRecipients(prisma, "ASSIGNED", targets);
  if (inApp.length) {
    await prisma.notification.createMany({
      data: inApp.map((userId) => ({ userId, actorId, type: "ASSIGNED" as const, message, link })),
    });
  }

  const settings = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { issueEmailNotify: true, emailNotificationsEnabled: true } });
  if (!settings?.issueEmailNotify) return;
  // 沿用既有的寄信閘門(使用者自己關掉「指派」email 就不寄);總開關 emailNotificationsEnabled 沒開時,
  // 這個專屬的開關仍然可以單獨寄(它就是 ISSUE TRACKER 自己的開關)。
  if (settings.emailNotificationsEnabled) {
    for (const userId of targets) await notifyEmailIfNeeded(userId, "ASSIGNED", message, link);
    return;
  }
  const users = await prisma.user.findMany({ where: { id: { in: targets } }, select: { email: true } });
  for (const u of users) await sendMail(u.email, "ISSUE TRACKER 指派通知", mailBody(message, link));
}
