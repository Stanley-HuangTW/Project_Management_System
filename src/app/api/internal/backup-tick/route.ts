import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { cleanupOldBackups, runBackup } from "@/lib/dbBackup";
import { isPastWeeklyTrigger } from "@/lib/weeklyReport";

/**
 * 資料庫備份的排程心跳。
 *
 * 跟 weekly-report-tick 同一套架構(見該檔的說明)——server.js 的 primary
 * process 每五分鐘打一次這裡,帶著只有它知道的內部密鑰。這支自己判斷
 * 「現在是不是已經過了設定的時間、今天跑過了沒」。
 *
 * 台灣沒有日光節約時間,固定 UTC+8 換算,不用拉時區資料庫進來。
 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const key = request.headers.get("x-internal-key");
  if (!key || key !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const settings = await getSystemSettings();
  if (!settings.backupEnabled) {
    return NextResponse.json({ ran: false, reason: "排程未啟用" });
  }

  const taipeiNow = new Date(Date.now() + TAIPEI_OFFSET_MS);
  const nowParts = { dow: taipeiNow.getUTCDay(), hour: taipeiNow.getUTCHours(), minute: taipeiNow.getUTCMinutes() };
  // DAILY 不比對星期幾——兩邊的 dow 給同一個固定值,比對式自然落到只看時分。
  const triggerDow = settings.backupFrequency === "WEEKLY" ? settings.backupDow : nowParts.dow;
  const pastTrigger = isPastWeeklyTrigger(nowParts, {
    dow: triggerDow,
    hour: settings.backupHour,
    minute: settings.backupMinute,
  });
  if (!pastTrigger) {
    return NextResponse.json({ ran: false, reason: "還沒到設定的時間" });
  }

  const todayIso = taipeiNow.toISOString().slice(0, 10);
  if (settings.backupLastRunDate === todayIso) {
    return NextResponse.json({ ran: false, reason: "今天已經跑過了" });
  }

  // 條件式 updateMany 當原子鎖——搶輸的代表已經有另一次請求把今天標成跑過
  // 了,不用重跑一次。單一 container 部署下這一步其實是保險,不是真的在
  // 防併發(跟 weekly-report-tick 同一個理由)。
  const claimed = await prisma.systemSettings.updateMany({
    where: {
      id: "global",
      OR: [{ backupLastRunDate: null }, { backupLastRunDate: { not: todayIso } }],
    },
    data: { backupLastRunDate: todayIso },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ ran: false, reason: "被搶先跑過了" });
  }

  try {
    const result = await runBackup();
    await cleanupOldBackups(settings.backupRetentionDays);
    return NextResponse.json({ ran: true, timestamp: result.timestamp });
  } catch (err) {
    return NextResponse.json({ ran: false, error: err instanceof Error ? err.message : "備份失敗" });
  }
}

/** 給人在瀏覽器確認端點活著,不需要密鑰。 */
export async function GET() {
  return NextResponse.json({
    name: "資料庫備份排程心跳",
    usage: "由 server.js 每 5 分鐘 POST 一次,帶 x-internal-key header",
    note: "自己判斷時間到了沒、今天跑過了沒,不是每次被打就一定動作。",
  });
}
