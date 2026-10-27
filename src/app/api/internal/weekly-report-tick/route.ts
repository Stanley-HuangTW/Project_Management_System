import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { deliverProgramReports } from "@/lib/weeklyReportRun";
import { sendWeeklyReportReminder, type ReminderOutcome } from "@/lib/weeklyReminderServer";
import {
  isPastWeeklyTrigger,
  minutesPastWeeklyTrigger,
  shouldRetryWeeklyRun,
  summarizeWeeklyRun,
  weeklyRunPlan,
  WEEKLY_RETRY_GAP_MINUTES,
} from "@/lib/weeklyReport";

/**
 * 專案週報分發的排程心跳。
 *
 * 不是外部排程器打的——server.js 的 primary process(整個部署裡天然只有
 * 一份,見那個檔案的註解)每五分鐘打一次這裡,帶著只有它知道的內部密鑰。
 * 這支自己判斷「現在是不是已經過了設定的時間、這週跑過了沒」,不是每次
 * 被打就一定會動作。
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

  // 週報產生前 N 小時的提醒信:跟週報本身各自判斷,提醒失敗不該連累週報照常產生。
  let reminder: ReminderOutcome;
  try {
    reminder = await sendWeeklyReportReminder(settings);
  } catch (err) {
    reminder = { sent: false, reason: err instanceof Error ? err.message : "提醒信失敗" };
  }
  const respond = (body: Record<string, unknown>) => NextResponse.json({ ...body, reminder });

  if (!settings.weeklyReportEnabled) {
    return respond({ ran: false, reason: "排程未啟用" });
  }

  const taipeiNow = new Date(Date.now() + TAIPEI_OFFSET_MS);
  const nowParts = { dow: taipeiNow.getUTCDay(), hour: taipeiNow.getUTCHours(), minute: taipeiNow.getUTCMinutes() };
  const trigger = { dow: settings.weeklyReportDow, hour: settings.weeklyReportHour, minute: settings.weeklyReportMinute };
  const pastTrigger = isPastWeeklyTrigger(nowParts, trigger);
  if (!pastTrigger) {
    return respond({ ran: false, reason: "還沒到設定的時間" });
  }

  // 排程報的是剛結束的那個範圍(從星期幾到星期幾,照系統設定,預設週三到週二),不是才剛開始的
  // ——跟 /api/reports/weekly 預設 week=last 是同一個道理。「這週跑過了沒」仍然照日曆上的週算,
  // 排程本來就是每個日曆週跑一次。
  const { weekKey: thisWeekKey, target } = weeklyRunPlan(taipeiNow.toISOString().slice(0, 10), {
    startDow: settings.weeklyReportRangeStartDow,
    endDow: settings.weeklyReportRangeEndDow,
  });

  if (settings.weeklyReportLastRunWeek === thisWeekKey) {
    return respond({ ran: false, reason: "這週已經跑過了" });
  }

  // 上一輪全部寄失敗、被放回「還沒跑」之後,隔一段時間才重試——不要每 5 分鐘就去敲壞掉的 SMTP。
  if (settings.weeklyReportLastRunAt && Date.now() - settings.weeklyReportLastRunAt.getTime() < WEEKLY_RETRY_GAP_MINUTES * 60_000) {
    return respond({ ran: false, reason: "上一輪寄信失敗,稍後自動重試" });
  }

  // 條件式 updateMany 當原子鎖——搶輸的(count === 0)代表已經有另一次
  // 請求把這週標成跑過了,不用重跑一次。單一 container 部署下本來就不太
  // 會真的撞在一起,這一步是保險,不是真的在防併發。
  // SQL 的 <> 不會比對到 NULL,只寫 { not: thisWeekKey } 在從來沒跑過
  // (欄位是 NULL)的時候會直接比對不到任何一列,誤判成「搶輸了」——
  // 明講「是 NULL,或者不是這一週」兩種都算。
  // 一搶到就先記下「進行中」:跑到一半 process 被重啟的話,設定頁會停在這一行,看得出是中途斷掉、不是根本沒跑。
  const claimed = await prisma.systemSettings.updateMany({
    where: {
      id: "global",
      OR: [{ weeklyReportLastRunWeek: null }, { weeklyReportLastRunWeek: { not: thisWeekKey } }],
    },
    data: { weeklyReportLastRunWeek: thisWeekKey, weeklyReportLastRunAt: new Date(), weeklyReportLastRunNote: `${thisWeekKey}:進行中(如果一直停在這一行,代表跑到一半就中斷了)` },
  });
  if (claimed.count === 0) {
    return respond({ ran: false, reason: "被搶先跑過了" });
  }

  const results = await deliverProgramReports(target);

  // 一封都沒寄出去(寄信失敗、產生報告出錯)而且還在重試的時間內:這一輪不算跑過,放回去下次再試
  // (跟提醒信同一個做法);有寄出去幾封就不重來,免得有人收到兩封。結果留在資料庫,設定頁看得到
  // (這個回應 server.js 不會看)。
  const retry = shouldRetryWeeklyRun(results, minutesPastWeeklyTrigger(nowParts, trigger));
  await prisma.systemSettings.update({
    where: { id: "global" },
    data: {
      weeklyReportLastRunAt: new Date(),
      weeklyReportLastRunNote:
        summarizeWeeklyRun(thisWeekKey, results) + (retry ? `;全部寄失敗,${WEEKLY_RETRY_GAP_MINUTES} 分鐘後自動重試` : ""),
      ...(retry ? { weeklyReportLastRunWeek: settings.weeklyReportLastRunWeek } : {}),
    },
  });

  return respond({ ran: true, week: thisWeekKey, results });
}

/** 給人在瀏覽器確認端點活著,不需要密鑰。 */
export async function GET() {
  return NextResponse.json({
    name: "專案週報分發排程心跳",
    usage: "由 server.js 每 5 分鐘 POST 一次,帶 x-internal-key header",
    note: "自己判斷時間到了沒、這週跑過了沒,不是每次被打就一定動作。",
  });
}
