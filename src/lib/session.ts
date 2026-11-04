import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  SESSION_DURATION_SECONDS,
  SessionPayload,
  createSessionToken,
  verifySessionToken,
} from "@/lib/jwt";

export async function setSessionCookie(payload: SessionPayload, durationSeconds = SESSION_DURATION_SECONDS) {
  const token = await createSessionToken(payload, durationSeconds);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // 只有真的用 https 服務才能標 secure——標了但實際是 http 的話,瀏覽器會
    // 直接不設定這顆 cookie(不會報錯),導致登入後馬上又被彈回登入頁。
    // NODE_ENV==="production" 不代表有 https,跟著 APP_BASE_URL 的協定走才對。
    secure: (process.env.APP_BASE_URL ?? "").startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: durationSeconds,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  // JWT 裡的 role 只是登入當下的快照(cookie 最長活 7 天)。如果之後有人在
  // DB 把這個使用者升/降權,要立刻生效,不能讓畫面和權限檢查一直看著舊角色,
  // 直到他重新登入。代操作時 userId 是被檢視者,查到的就是對方現在的角色。
  const current = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { role: true },
  });
  if (!current) return null;

  return { ...payload, role: current.role };
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
