"use server";

import { prisma } from "@/lib/prisma";
import { clearSessionCookie, requireSession, setSessionCookie } from "@/lib/session";
import { logAudit } from "@/lib/activityLog";
import { IMPERSONATION_SECONDS, startImpersonationError } from "@/lib/impersonation";

export type ImpersonationUser = { id: string; name: string; email: string; role: "ADMIN" | "SUPERVISOR" | "MEMBER" };

/** 個人資料視窗的下拉選單:管理者(而且不在代操作中)才有,其他人拿到空清單。 */
export async function listImpersonationUsers(): Promise<ImpersonationUser[]> {
  const session = await requireSession();
  if (session.impersonatorId) return [];
  const actor = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true } });
  if (actor?.role !== "ADMIN") return [];
  return prisma.user.findMany({
    where: { id: { not: session.userId } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true },
  });
}

/**
 * 管理者切換成另一個使用者的視角:登入狀態換成對方(畫面、權限、可以做的事都跟對方一樣),
 * 另外記著真正的管理者是誰。操作會寫進稽核軌跡,而且 4 小時後自動失效。
 * 錯誤用回傳值帶回去(正式環境丟出來的訊息會被洗成一句通用的話)。
 */
export async function startImpersonation(userId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId }, select: { role: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, role: true } }),
  ]);
  const error = startImpersonationError(session, actor?.role ?? null, userId, target !== null);
  if (error || !target) return { error: error ?? "找不到這個使用者" };

  // 先記再換:這一筆還是用管理者自己的登入狀態寫的。
  await logAudit("ACCESS", session.userId, `開始以「${target.name}」(${target.email})的身分檢視`);
  await setSessionCookie(
    {
      userId: target.id,
      email: target.email,
      name: target.name,
      role: target.role,
      impersonatorId: session.userId,
      impersonatorName: session.name,
    },
    IMPERSONATION_SECONDS
  );
  return {};
}

/** 退出,回到管理者自己。管理者帳號已經不存在或不再是管理者的話,直接登出。 */
export async function stopImpersonation(): Promise<{ error?: string }> {
  const session = await requireSession();
  if (!session.impersonatorId) return {};

  // actorId 明確給管理者(跟登入狀態裡的被檢視者不同),這一筆不會再被加註一次。
  await logAudit("ACCESS", session.impersonatorId, `結束以「${session.name}」的身分檢視`);

  const admin = await prisma.user.findUnique({
    where: { id: session.impersonatorId },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!admin || admin.role !== "ADMIN") {
    await clearSessionCookie();
    return {};
  }
  await setSessionCookie({ userId: admin.id, email: admin.email, name: admin.name, role: admin.role });
  return {};
}
