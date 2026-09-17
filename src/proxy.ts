import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/jwt";

const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  // OAuth 的自我描述要能不帶任何憑證就讀得到 —— 用戶端就是靠它找到授權
  // 伺服器在哪裡,擋在登入後面的話連接器連談都談不起來。
  "/.well-known/",
  // 同意畫面自己處理未登入:它要把原本的查詢參數包成 next 帶去登入頁,
  // 交給這裡導的話那串參數會掉,授權流程就斷在這一步。
  "/oauth/authorize",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
