import { NextResponse } from "next/server";
import { sendTodoDeadlineReminders } from "@/lib/todoReminderServer";

/**
 * 待辦事項期限提醒的排程心跳。
 *
 * 跟 weekly-report-tick 同一套架構(見該檔的說明)——server.js 的 primary
 * process 每五分鐘打一次這裡,帶著只有它知道的內部密鑰。這支自己判斷
 * 「現在是不是台北早上 9 點之後、有哪些待辦事項該提醒」,不是每次被打就一定動作。
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-internal-key");
  if (!key || key !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await sendTodoDeadlineReminders());
}

/** 給人在瀏覽器確認端點活著,不需要密鑰。 */
export async function GET() {
  return NextResponse.json({
    name: "待辦事項期限提醒排程心跳",
    usage: "由 server.js 每 5 分鐘 POST 一次,帶 x-internal-key header",
    note: "自己判斷時間到了沒、哪些待辦事項該提醒,不是每次被打就一定動作。",
  });
}
