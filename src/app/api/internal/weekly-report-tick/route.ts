import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { buildProgramWeeklyReportData } from "@/lib/weeklyReportServer";
import { deliverProgramReport } from "@/lib/weeklyReportDelivery";
import { weekRangeOf, previousWeekOf, isoWeekLabel, isPastWeeklyTrigger } from "@/lib/weeklyReport";

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
  if (!settings.weeklyReportEnabled) {
    return NextResponse.json({ ran: false, reason: "排程未啟用" });
  }

  const taipeiNow = new Date(Date.now() + TAIPEI_OFFSET_MS);
  const pastTrigger = isPastWeeklyTrigger(
    { dow: taipeiNow.getUTCDay(), hour: taipeiNow.getUTCHours(), minute: taipeiNow.getUTCMinutes() },
    { dow: settings.weeklyReportDow, hour: settings.weeklyReportHour, minute: settings.weeklyReportMinute }
  );
  if (!pastTrigger) {
    return NextResponse.json({ ran: false, reason: "還沒到設定的時間" });
  }

  // 排程是「每週一早上」這種語意,報的是剛結束的那一週,不是才剛開始的
  // 這一週——跟 /api/reports/weekly 預設 week=last 是同一個道理。
  const todayIso = taipeiNow.toISOString().slice(0, 10);
  const thisWeek = weekRangeOf(todayIso);
  const target = previousWeekOf(thisWeek.weekStart).weekStart;
  const thisWeekKey = isoWeekLabel(thisWeek.weekStart);

  if (settings.weeklyReportLastRunWeek === thisWeekKey) {
    return NextResponse.json({ ran: false, reason: "這週已經跑過了" });
  }

  // 條件式 updateMany 當原子鎖——搶輸的(count === 0)代表已經有另一次
  // 請求把這週標成跑過了,不用重跑一次。單一 container 部署下本來就不太
  // 會真的撞在一起,這一步是保險,不是真的在防併發。
  // SQL 的 <> 不會比對到 NULL,只寫 { not: thisWeekKey } 在從來沒跑過
  // (欄位是 NULL)的時候會直接比對不到任何一列,誤判成「搶輸了」——
  // 明講「是 NULL,或者不是這一週」兩種都算。
  const claimed = await prisma.systemSettings.updateMany({
    where: {
      id: "global",
      OR: [{ weeklyReportLastRunWeek: null }, { weeklyReportLastRunWeek: { not: thisWeekKey } }],
    },
    data: { weeklyReportLastRunWeek: thisWeekKey },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ ran: false, reason: "被搶先跑過了" });
  }

  const subscriptions = await prisma.programReportSubscription.findMany({
    include: { recipients: { include: { user: { select: { email: true } } } } },
  });

  const results: { programId: string; sent: number; failed: number; error?: string }[] = [];
  for (const sub of subscriptions) {
    const emails = [...new Set(sub.recipients.map((r) => r.user?.email ?? r.email).filter((e): e is string => !!e))];
    if (emails.length === 0) continue;

    // 一個專案失敗不該讓其他專案也收不到——記下來、繼續下一個。
    try {
      const report = await buildProgramWeeklyReportData(sub.programId, target, {
        upcomingDays: sub.upcomingDays,
        include: {
          summary: sub.includeSummary,
          programs: sub.includeProgramDiff,
          departments: sub.includeDepartments,
          activity: sub.includeActivity,
        },
      });
      if (!report) continue;
      const delivery = await deliverProgramReport(report.programName, report.snapshot, report.markdown, emails);
      results.push({
        programId: sub.programId,
        sent: delivery.mail.filter((m) => m.ok).length,
        failed: delivery.mail.filter((m) => !m.ok).length,
      });
    } catch (err) {
      results.push({
        programId: sub.programId,
        sent: 0,
        failed: emails.length,
        error: err instanceof Error ? err.message : "未知錯誤",
      });
    }
  }

  return NextResponse.json({ ran: true, week: thisWeekKey, results });
}

/** 給人在瀏覽器確認端點活著,不需要密鑰。 */
export async function GET() {
  return NextResponse.json({
    name: "專案週報分發排程心跳",
    usage: "由 server.js 每 5 分鐘 POST 一次,帶 x-internal-key header",
    note: "自己判斷時間到了沒、這週跑過了沒,不是每次被打就一定動作。",
  });
}
