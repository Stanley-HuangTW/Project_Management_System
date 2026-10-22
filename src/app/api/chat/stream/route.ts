import { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { getChatHub } from "@/lib/chatServer";
import { formatSseEvent } from "@/lib/chat";

// 長連線,每個請求都要跑,不能被預先產生或快取。
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;

/**
 * 對話的即時推送(Server-Sent Events)。只送「哪間對話有新動靜」,不帶訊息內容;
 * 瀏覽器收到再用有權限檢查的 action 去讀內容。登入檢查在這裡自己做(proxy.ts 不攔 /api)。
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("未登入", { status: 401 });
  // 代操作時不開對話(見 actions/chat.ts)。
  if (session.impersonatorId) return new Response("代操作時不能使用對話功能", { status: 403 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };

      const unsubscribe = await getChatHub().subscribe({ userId: session.userId, role: session.role }, (payload) =>
        write(formatSseEvent(payload))
      );
      // 先寫一行註解,讓標頭與第一個位元組馬上送出去、瀏覽器的 onopen 才會觸發;之後定時送心跳,
      // 不然閒置的連線會被中間的代理伺服器當成斷線掐掉。
      write(": connected\n\n");
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // 已經關了。
        }
      };
      request.signal.addEventListener("abort", cleanup);
      if (request.signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform:Next 預設會對回應做 gzip,壓縮會把小小的事件攢著不送。
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 若前面有 nginx 之類的代理,也不要緩衝。
      "X-Accel-Buffering": "no",
    },
  });
}
