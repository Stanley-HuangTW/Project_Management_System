import { NextResponse } from "next/server";
import { exchangeAuthCode, refreshTokens } from "@/lib/oauth/server";

/**
 * 換權杖。
 *
 * 支援 authorization_code 與 refresh_token 兩種。兩種都不需要 client 密鑰
 * ——MCP 的用戶端是公開用戶端,密鑰藏不住,所以保護來自 PKCE 與完全相同
 * 的 redirect_uri 比對。
 *
 * 回應一律 no-store:權杖不該留在任何一層快取裡。
 */

function bad(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}

export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    const raw = await request.text();
    form = new URLSearchParams(raw);
  } catch {
    return bad("invalid_request", "請求內容讀不到");
  }

  const grantType = form.get("grant_type");
  const clientId = form.get("client_id");
  if (!clientId) return bad("invalid_client", "缺少 client_id");

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const redirectUri = form.get("redirect_uri");
    const verifier = form.get("code_verifier");
    if (!code) return bad("invalid_request", "缺少 code");
    if (!redirectUri) return bad("invalid_request", "缺少 redirect_uri");
    if (!verifier) return bad("invalid_request", "缺少 code_verifier(本端點強制 PKCE)");

    const result = await exchangeAuthCode({ code, clientId, redirectUri, codeVerifier: verifier });
    if (!result.ok) return bad(result.error, result.description);
    return tokenResponse(result.tokens);
  }

  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (!refreshToken) return bad("invalid_request", "缺少 refresh_token");

    const result = await refreshTokens({ refreshToken, clientId });
    if (!result.ok) return bad(result.error, result.description);
    return tokenResponse(result.tokens);
  }

  return bad("unsupported_grant_type", "只支援 authorization_code 與 refresh_token");
}

function tokenResponse(tokens: { accessToken: string; refreshToken: string; expiresInSeconds: number }) {
  return NextResponse.json(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresInSeconds,
      refresh_token: tokens.refreshToken,
      scope: "mcp",
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}
