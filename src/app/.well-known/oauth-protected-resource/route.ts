import { NextResponse } from "next/server";
import { issuer } from "@/lib/oauth/server";

/**
 * 受保護資源的自我描述(RFC 9728)。
 *
 * 用戶端收到 401 之後,照 WWW-Authenticate 指過來這裡,才知道該找哪一台
 * 授權伺服器要權杖。
 */
export async function GET() {
  const base = issuer();
  return NextResponse.json(
    {
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
