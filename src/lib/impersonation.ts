import type { SessionPayload } from "./jwt";

/** 以別人的身分檢視最久多久。忘了退出也不會一直掛著——到期就要重新登入。 */
export const IMPERSONATION_SECONDS = 4 * 60 * 60;

/**
 * 管理者能不能開始以另一個使用者的身分檢視。回傳不能的原因,可以就回 null。
 * actorRole 要是資料庫裡現在的角色,不是登入時記在 session 裡的(後來被降權的管理者就不能再切)。
 */
export function startImpersonationError(
  session: Pick<SessionPayload, "userId" | "impersonatorId">,
  actorRole: string | null,
  targetId: string,
  targetExists: boolean
): string | null {
  if (session.impersonatorId) return "目前已經在以別人的身分檢視,請先退出再切換";
  if (actorRole !== "ADMIN") return "只有管理者可以切換使用者視角";
  if (!targetExists) return "找不到這個使用者";
  if (targetId === session.userId) return "不能切換成自己";
  return null;
}

/**
 * 稽核紀錄要記真正動手的人:以別人的身分操作時,actorId 換成管理者,訊息後面註記是以誰的身分。
 * 不是代操作、或這筆紀錄的 actorId 本來就不是被檢視的人,就照原樣。
 */
export function attributeAudit(
  session: Pick<SessionPayload, "userId" | "name" | "impersonatorId"> | null,
  actorId: string | null,
  message: string
): { actorId: string | null; message: string } {
  if (session?.impersonatorId && actorId === session.userId) {
    return { actorId: session.impersonatorId, message: `${message}〔管理者以「${session.name}」的身分操作〕` };
  }
  return { actorId, message };
}
