import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { parseRegistration } from "@/lib/oauth/params";

/**
 * 動態用戶端註冊(RFC 7591)。
 *
 * 開放註冊,但註冊本身不代表任何權限 —— 登記一個 client_id 只是讓它有資
 * 格把人導到同意畫面。真正的授權要等某個人在那個畫面上按下允許,而且拿到
 * 的範圍完全等同那個人自己看得到的範圍。
 *
 * 不發 client_secret:MCP 的用戶端是公開用戶端(密鑰藏不住),安全性靠
 * PKCE 與完全相同的 redirect_uri 比對,不靠一個會外流的密鑰。
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "請求內容不是合法的 JSON" },
      { status: 400 }
    );
  }

  const parsed = parseRegistration(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, error_description: parsed.description },
      { status: 400 }
    );
  }

  const clientId = `mcp_${randomBytes(16).toString("hex")}`;
  const client = await prisma.oAuthClient.create({
    data: {
      clientId,
      name: parsed.value.clientName,
      redirectUris: parsed.value.redirectUris,
    },
  });

  return NextResponse.json(
    {
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    },
    { status: 201 }
  );
}
