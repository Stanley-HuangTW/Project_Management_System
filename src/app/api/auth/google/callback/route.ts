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
  const target = isSafeReturnPath(returnTo) ? returnTo : "/";
  // 日曆與 Google Sheet 共用同一個回呼網址(Google Cloud 只要登記一個),state 的前綴分辨是哪一條。
  const expectedState = request.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  const isCalendar = !!expectedState?.startsWith(GOOGLE_CALENDAR_STATE_PREFIX);

  function redirectWithStatus(status: "success" | "error") {
    const param = isCalendar ? "googleCalendarAuth" : "googleSheetsAuth";
    const res = NextResponse.redirect(new URL(`${target}?${param}=${status}`, request.url));
    res.cookies.delete(GOOGLE_STATE_COOKIE);
    res.cookies.delete(GOOGLE_RETURN_TO_COOKIE);
    return res;
  }

  const session = await getSession();
  if (!session) return redirectWithStatus("error");
  // 匯入 Google Sheet 只有管理者;連自己的日曆任何登入的人都可以。
  if (!isCalendar) {
    try {
      requireBoardAdmin(session.role);
    } catch {
      return redirectWithStatus("error");
    }
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) return redirectWithStatus("error");
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectWithStatus("error");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectWithStatus("error");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) return redirectWithStatus("error");
  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokenData.access_token) return redirectWithStatus("error");

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
