import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_STATE_PREFIX,
  GOOGLE_RETURN_TO_COOKIE,
  GOOGLE_STATE_COOKIE,
  googleRedirectUri,
  isSafeReturnPath,
} from "@/lib/googleAuth";

/** 連結 Google 日曆(唯讀)。任何登入的人都能連自己的日曆——跟匯入 Google Sheet 那條不同,不限管理者。 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return new NextResponse("伺服器尚未設定 GOOGLE_CLIENT_ID", { status: 500 });

  const state = `${GOOGLE_CALENDAR_STATE_PREFIX}${randomUUID()}`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", googleRedirectUri());
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  authUrl.searchParams.set("access_type", "online");
  // consent=1:上次授權漏勾了讀日曆的權限,重新連結時強制再顯示一次同意畫面。
  authUrl.searchParams.set("prompt", request.nextUrl.searchParams.get("consent") === "1" ? "select_account consent" : "select_account");
  authUrl.searchParams.set("state", state);

  const cookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 300,
  };
  const res = NextResponse.redirect(authUrl);
  res.cookies.set(GOOGLE_STATE_COOKIE, state, cookie);
  const returnTo = request.nextUrl.searchParams.get("returnTo");
  if (isSafeReturnPath(returnTo)) res.cookies.set(GOOGLE_RETURN_TO_COOKIE, returnTo, cookie);
  return res;
}
