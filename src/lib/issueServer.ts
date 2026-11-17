import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession, requireSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";
import { UserError } from "@/lib/userError";
import {
  effectiveIssueRole,
  postLoginPath,
  systemAccess,
  type IssueRole,
  type SystemAccess,
} from "@/lib/issueAccess";

/**
 * 這個人能進哪些系統。每次現查資料庫(跟 getSession 刷新角色同一個理由:管理者調整權限要立刻生效,
 * 不能等對方重新登入)。不在 "use server" 檔案裡:那裡的匯出都會變成對外的 Server Action。
 */
export async function loadSystemAccess(session: SessionPayload): Promise<SystemAccess & { issueRole: IssueRole | null }> {
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true, pmAccess: true, issueRole: true },
  });
  if (!user) return { pm: false, issues: false, issueRole: null };
  return { ...systemAccess(user), issueRole: effectiveIssueRole(user) };
}

/** 頁面用:沒登入去登入頁;不能進 ISSUE TRACKER 就送去他能去的地方。 */
export async function requireIssueSession(): Promise<{ session: SessionPayload; role: IssueRole }> {
  const session = await requireSession();
  const access = await loadSystemAccess(session);
  if (!access.issues || !access.issueRole) redirect(postLoginPath(access));
  return { session, role: access.issueRole };
}

/** Server Action 用:沒有 ISSUE TRACKER 權限丟 UserError。 */
export async function requireIssueActor(): Promise<{ session: SessionPayload; role: IssueRole; userId: string }> {
  const session = await requireSession();
  const access = await loadSystemAccess(session);
  if (!access.issues || !access.issueRole) throw new UserError("權限不足:你沒有 ISSUE TRACKER 的使用權限");
  return { session, role: access.issueRole, userId: session.userId };
}

/** 選項管理與只有管理者能做的事。 */
export async function requireIssueManager() {
  const actor = await requireIssueActor();
  if (actor.role !== "MANAGER") throw new UserError("權限不足:只有管理者可以執行此操作");
  return actor;
}

/** Route handler 用:不丟例外、不轉址,回 null 讓呼叫端回 401/403。 */
export async function getIssueActor(): Promise<{ session: SessionPayload; role: IssueRole; userId: string } | null> {
  const session = await getSession();
  if (!session) return null;
  const access = await loadSystemAccess(session);
  if (!access.issues || !access.issueRole) return null;
  return { session, role: access.issueRole, userId: session.userId };
}
