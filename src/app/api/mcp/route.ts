import { NextResponse } from "next/server";
import { sessionFromBearer } from "@/lib/apiAuth";
import { issuer } from "@/lib/oauth/server";
import { TOOLS, callTool } from "@/lib/mcp/tools";

/**
 * MCP 端點(Streamable HTTP)。
 *
 * 手寫的 JSON-RPC 子集,不拉 SDK:實際用到的只有 initialize、tools/list、
 * tools/call 三個方法,而且回應是單純的 JSON —— 這幾支工具都是一問一答,
 * 沒有需要串流的長流程。
 *
 * 驗證用既有的 API 金鑰,金鑰借用擁有者的權限,所以所有既有的看板篩選
 * 原封不動套用。
 */

const PROTOCOL_VERSION = "2024-11-05";

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown };

function result(id: RpcRequest["id"], value: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result: value });
}

function rpcError(id: RpcRequest["id"], code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

export async function POST(request: Request) {
  let body: RpcRequest | RpcRequest[];
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "請求不是合法的 JSON", 400);
  }

  // 批次請求:規格允許,實務上很少用,但拒絕得說清楚而不是安靜地失敗。
  if (Array.isArray(body)) {
    return rpcError(null, -32600, "這個端點一次只處理一個請求", 400);
  }

  const { id = null, method, params } = body ?? {};
  if (!method) return rpcError(id, -32600, "缺少 method");

  // 通知(沒有 id)不需要回應內容。
  if (method === "notifications/initialized") {
    return new NextResponse(null, { status: 202 });
  }

  const session = await sessionFromBearer(request);
  if (!session) {
    // WWW-Authenticate 指向資源描述,MCP 用戶端照著它就能自己找到授權伺服
    // 器並跑完 OAuth —— 沒有這個標頭,連接器只會看到一個沒得談的 401。
    const response = rpcError(
      id,
      -32001,
      "需要授權:用 OAuth 連接器登入,或在 Authorization 標頭帶 Bearer <API 金鑰>(系統設定 → 整合)。",
      401
    );
    response.headers.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${issuer()}/.well-known/oauth-protected-resource"`
    );
    return response;
  }

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "工作管理平台", version: "1" },
      });

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, { tools: TOOLS });

    case "tools/call": {
      const call = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!call?.name) return rpcError(id, -32602, "缺少工具名稱");
      try {
        const value = await callTool(call.name, call.arguments ?? {}, session);
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        });
      } catch (err) {
        // 工具自己的錯誤(權限不足、找不到看板、SQL 被擋)回成 isError 的
        // 結果而不是傳輸層錯誤 —— 那是給呼叫的模型看的,它要能讀懂並改寫
        // 查詢,而不是把整條連線當成壞掉。
        return result(id, {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : "工具執行失敗" }],
        });
      }
    }

    default:
      return rpcError(id, -32601, `不支援的方法:${method}`);
  }
}

/** 讓人用瀏覽器打開時知道這是什麼、以及金鑰要放哪裡。 */
export async function GET() {
  return NextResponse.json({
    name: "工作管理平台 MCP",
    transport: "streamable-http",
    protocolVersion: PROTOCOL_VERSION,
    usage: "POST JSON-RPC 到這個網址,Authorization: Bearer <API 金鑰>",
    tools: TOOLS.map((t) => t.name),
  });
}
