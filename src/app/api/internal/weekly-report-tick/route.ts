import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { buildProgramWeeklyReportData } from "@/lib/weeklyReportServer";
import { sendWeeklyReportReminder, type ReminderOutcome } from "@/lib/weeklyReminderServer";
import { deliverProgramReport } from "@/lib/weeklyReportDelivery";
import {
  weekRangeOf,
  isoWeekLabel,
  isPastWeeklyTrigger,
  lastCompletedReportRange,
  summarizeWeeklyRun,
  type ProgramRunResult,
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
  const pastTrigger = isPastWeeklyTrigger(
    { dow: taipeiNow.getUTCDay(), hour: taipeiNow.getUTCHours(), minute: taipeiNow.getUTCMinutes() },
    { dow: settings.weeklyReportDow, hour: settings.weeklyReportHour, minute: settings.weeklyReportMinute }
  );
  if (!pastTrigger) {
    return respond({ ran: false, reason: "還沒到設定的時間" });
  }

  // 排程報的是剛結束的那個範圍(從星期幾到星期幾,照系統設定,預設週三到週二),不是才剛開始的
  // ——跟 /api/reports/weekly 預設 week=last 是同一個道理。「這週跑過了沒」仍然照日曆上的週算,
  // 排程本來就是每個日曆週跑一次。
  const todayIso = taipeiNow.toISOString().slice(0, 10);
  const thisWeek = weekRangeOf(todayIso);
  const target = lastCompletedReportRange(todayIso, {
    startDow: settings.weeklyReportRangeStartDow,
    endDow: settings.weeklyReportRangeEndDow,
  }).weekStart;
  const thisWeekKey = isoWeekLabel(thisWeek.weekStart);

  if (settings.weeklyReportLastRunWeek === thisWeekKey) {
    return respond({ ran: false, reason: "這週已經跑過了" });
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

  const subscriptions = await prisma.programReportSubscription.findMany({
    include: { program: { select: { name: true } }, recipients: { include: { user: { select: { email: true } } } } },
  });

  const results: ProgramRunResult[] = [];
  for (const sub of subscriptions) {
    const emails = [...new Set(sub.recipients.map((r) => r.user?.email ?? r.email).filter((e): e is string => !!e))];
    if (emails.length === 0) {
      results.push({ programName: sub.program.name, sent: 0, failed: 0, detail: "沒有收件人" });
      continue;
    }

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
      if (!report) {
        results.push({ programName: sub.program.name, sent: 0, failed: 0, detail: "這個專案群組底下沒有看板" });
        continue;
      }
      const delivery = await deliverProgramReport(report.programName, report.snapshot, report.markdown, emails);
      results.push({
        programName: sub.program.name,
        sent: delivery.mail.filter((m) => m.ok).length,
        failed: delivery.mail.filter((m) => !m.ok).length,
        detail: delivery.mail.find((m) => !m.ok)?.reason,
      });
    } catch (err) {
      results.push({
        programName: sub.program.name,
        sent: 0,
        failed: emails.length,
        detail: `產生週報時出錯:${err instanceof Error ? err.message : "未知錯誤"}`,
      });
    }
  }

  // 結果留在資料庫:設定頁看得到上次有沒有跑、寄成功了沒(這個回應 server.js 不會看)。
  await prisma.systemSettings.update({
    where: { id: "global" },
    data: { weeklyReportLastRunAt: new Date(), weeklyReportLastRunNote: summarizeWeeklyRun(thisWeekKey, results) },
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
