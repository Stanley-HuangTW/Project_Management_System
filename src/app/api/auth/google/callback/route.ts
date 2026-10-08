import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import {
  GOOGLE_CALENDAR_STATE_PREFIX,
  GOOGLE_CALENDAR_TOKEN_COOKIE,
  GOOGLE_CALENDAR_TOKEN_MAX_AGE_SECONDS,
  GOOGLE_STATE_COOKIE,
  GOOGLE_TOKEN_COOKIE,
  GOOGLE_RETURN_TO_COOKIE,
  googleRedirectUri,
  isSafeReturnPath,
} from "@/lib/googleAuth";

// Token lifetime is capped short since it's only meant to be used once, for
// the single Google Sheet fetch the user is about to retry — not persisted.
const TOKEN_COOKIE_MAX_AGE_SECONDS = 300;

export async function GET(request: NextRequest) {
  const returnTo = request.cookies.get(GOOGLE_RETURN_TO_COOKIE)?.value;
  // 日曆與 Google Sheet 共用同一個回呼網址(Google Cloud 只要登記一個),state 的前綴分辨是哪一條。
  // 暫存的 state cookie 沒帶回來時(最常見的失敗原因),退而用 Google 原樣帶回來的 state 判斷,
  // 這樣失敗的訊息才會出現在對的畫面上,而不是默默回到首頁。
  const expectedState = request.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  const isCalendar = !!(expectedState ?? request.nextUrl.searchParams.get("state"))?.startsWith(GOOGLE_CALENDAR_STATE_PREFIX);
  const target = isSafeReturnPath(returnTo) ? returnTo : isCalendar ? "/timesheet" : "/";

  function redirectWithStatus(status: "success" | "error", reason?: string, detail?: string) {
    const param = isCalendar ? "googleCalendarAuth" : "googleSheetsAuth";
    const query = new URLSearchParams({ [param]: status });
    if (status === "error" && reason) {
      // 失敗的原因一併帶回去,畫面才說得出哪裡出問題;伺服器的紀錄也留一筆,管理者查得到。
      query.set("googleAuthReason", reason);
      if (detail) query.set("googleAuthDetail", detail.slice(0, 160));
      if (reason === "token" && detail?.startsWith("redirect_uri_mismatch")) query.set("googleAuthUri", googleRedirectUri());
      console.error(`[google-oauth] ${isCalendar ? "calendar" : "sheets"} 授權失敗:${reason}${detail ? ` (${detail.slice(0, 160)})` : ""}`);
    }
    const res = NextResponse.redirect(new URL(`${target}?${query}`, request.url));
    res.cookies.delete(GOOGLE_STATE_COOKIE);
    res.cookies.delete(GOOGLE_RETURN_TO_COOKIE);
    return res;
  }

  const session = await getSession();
  if (!session) return redirectWithStatus("error", "session");
  // 匯入 Google Sheet 只有管理者;連自己的日曆任何登入的人都可以。
  if (!isCalendar) {
    try {
      requireBoardAdmin(session.role);
    } catch {
      return redirectWithStatus("error", "session");
    }
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) return redirectWithStatus("error", "denied", oauthError);
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectWithStatus("error", "state", expectedState ? "mismatch" : "nocookie");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectWithStatus("error", "config");
  }

  // 伺服器連不上 Google(公司內網常見)時 fetch 會直接丟例外——不接住就是一個空白的 500 頁。
  let tokenRes: Response;
  try {
    tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return redirectWithStatus("error", "network");
  }

  if (!tokenRes.ok) {
    // Google 說明原因的格式是 { error, error_description };只取代碼與簡短說明,不含任何憑證。
    const body = (await tokenRes.json().catch(() => null)) as { error?: string; error_description?: string } | null;
    return redirectWithStatus("error", "token", [body?.error, body?.error_description].filter(Boolean).join(": ") || `HTTP ${tokenRes.status}`);
  }
  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokenData.access_token) return redirectWithStatus("error", "notoken");

  const res = redirectWithStatus("success");
  const maxAgeLimit = isCalendar ? GOOGLE_CALENDAR_TOKEN_MAX_AGE_SECONDS : TOKEN_COOKIE_MAX_AGE_SECONDS;
  res.cookies.set(isCalendar ? GOOGLE_CALENDAR_TOKEN_COOKIE : GOOGLE_TOKEN_COOKIE, tokenData.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.min(tokenData.expires_in ?? maxAgeLimit, maxAgeLimit),
  });
  return res;
}
