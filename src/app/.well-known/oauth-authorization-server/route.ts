import { NextResponse } from "next/server";
import { issuer } from "@/lib/oauth/server";

/**
 * 授權伺服器的自我描述(RFC 8414)。
 *
 * MCP 用戶端照這一份自己找到註冊、授權與換權杖的端點 —— 沒有這一支,每
 * 接一個用戶端都得有人手動填三個網址。
 */
export async function GET() {
  const base = issuer();
  return NextResponse.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      // 只列 S256:plain 等於沒做 PKCE,這個端點不收。
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
