import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  return verifySessionToken(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
