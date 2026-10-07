import { NextResponse } from "next/server";
import { runMantisSyncTick } from "@/lib/mantisSync";

/**
 * MantisBT 同步的排程心跳。
 *
 * 跟週報、備份一樣由 server.js 的 primary process 每五分鐘打一次,帶只有它知道的內部密鑰。
 * 這支自己判斷哪些連線該同步了(上次同步超過 15 分鐘的),不是每次被打就全部重抓。
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-internal-key");
  if (!key || key !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runMantisSyncTick();
  return NextResponse.json({ ran: true, ...result });
}

/** 給人在瀏覽器確認端點活著,不需要密鑰。 */
export async function GET() {
  return NextResponse.json({
    name: "MantisBT 同步排程心跳",
    usage: "由 server.js 每 5 分鐘 POST 一次,帶 x-internal-key header",
    note: "自己判斷哪些連線該同步了,不是每次被打就全部重抓。",
  });
}
