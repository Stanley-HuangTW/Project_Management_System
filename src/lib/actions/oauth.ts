"use server";

import { requireSession } from "@/lib/session";
import { logAudit } from "@/lib/activityLog";
import { matchRedirectUri, successRedirect } from "@/lib/oauth/params";
import { findClient, issueAuthCode } from "@/lib/oauth/server";

/**
 * 使用者在同意畫面按下「允許」。
 *
 * 每一個參數都**重新驗一次**,不信任表單送回來的內容 —— 表單欄位是使用者
 * 端可以改的,頁面載入時驗過不代表送出時還是同一組。特別是 redirect_uri:
 * 這裡是最後一道關,對不上就什麼都不發。
 */
export async function approveAuthorization(input: {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string | null;
}): Promise<{ error?: string; redirectTo?: string }> {
  const session = await requireSession();
  // 授權碼會換成「這個人」的長期存取憑證,不能在以別人的身分檢視時替對方發出去。
  if (session.impersonatorId) return { error: "以別人的身分檢視時,不能替對方授權應用程式存取" };

  const client = await findClient(input.clientId);
  if (!client) return { error: "找不到這個應用程式" };

  if (!matchRedirectUri(client.redirectUris, input.redirectUri)) {
    return { error: "導向網址不符,為了安全不會發出授權碼" };
  }

  // 頁面那一層已經檢查過格式,這裡再擋一次不合格式的 challenge —— 這支是
  // Server Action,可以被直接呼叫,不會只從那個頁面進來。
  if (!/^[A-Za-z0-9\-_]{43,128}$/.test(input.codeChallenge)) {
    return { error: "code_challenge 格式不正確" };
  }

  const code = await issueAuthCode({
    clientRowId: client.id,
    userId: session.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    resource: input.resource,
  });

  await logAudit(
    "ACCESS",
    session.userId,
    `授權「${client.name}」以自己的身分存取 MCP(client_id ${client.clientId})`
  );

  return { redirectTo: successRedirect(input.redirectUri, code, input.state) };
}
