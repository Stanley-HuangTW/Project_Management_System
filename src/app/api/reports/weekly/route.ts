import { NextResponse } from "next/server";
import { sessionFromApiKey } from "@/lib/apiAuth";
import { getSession } from "@/lib/session";
import { generateAndStoreWeeklyReport, getReportRange } from "@/lib/weeklyReportServer";
import { deliverWeeklyReport } from "@/lib/weeklyReportDelivery";
import { lastCompletedReportRange, reportRangeOf } from "@/lib/weeklyReport";
import { taipeiTodayIso } from "@/lib/timesheet";

/**
 * 產一份週報。
 *
 * 排程打這一支就好 —— 不必在容器裡多裝一套 TypeScript 執行環境,也不必把
 * 計算複製一份到腳本裡。驗證走既有的 API 金鑰,所以週報看得到的範圍跟發
 * 金鑰那個人登入時完全一樣。
 *
 * 也吃瀏覽器的登入狀態,這樣週報頁面上那顆「立即產生」可以打同一支。
 */

export async function POST(request: Request) {
  const session = (await sessionFromApiKey(request)) ?? (await getSession());
  if (!session) {
    return NextResponse.json(
      { error: "需要有效的 API 金鑰(Authorization: Bearer <key>)或登入狀態" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  // 預設是「上一期」:這支是給排程用的,那時候要的是剛結束的那個範圍,不是才剛開始的。
  // 範圍是從星期幾到星期幾,照系統設定(預設週三到週二),不一定是日曆上的週一到週日。
  const scope = url.searchParams.get("week") ?? "last";
  const today = taipeiTodayIso();
  const range = await getReportRange();
  const target =
    scope === "this"
      ? reportRangeOf(today, range).weekStart
      : scope === "last"
        ? lastCompletedReportRange(today, range).weekStart
        : scope;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) {
    return NextResponse.json(
      { error: "week 只能是 last、this,或 YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const deliver = url.searchParams.get("deliver") !== "0";

  try {
    const { snapshot, diff, markdown } = await generateAndStoreWeeklyReport(session, target);
    const delivery = deliver ? await deliverWeeklyReport(session, snapshot, diff, markdown) : null;
    return NextResponse.json({
      weekStart: snapshot.weekStart,
      weekEnd: snapshot.weekEnd,
      programs: snapshot.programs.map((p) => ({
        name: p.programName,
        boards: p.boards.length,
        overdue: p.items.filter((i) => i.bucket === "overdue").length,
        upcoming: p.items.filter((i) => i.bucket === "upcoming").length,
        milestones: p.items.filter((i) => i.isMilestone && i.bucket !== "done").length,
        critical: p.items.filter((i) => i.isCritical && i.bucket !== "done").length,
      })),
      departments: snapshot.departments.length,
      completedThisWeek: diff.firstEver ? null : diff.completed.length,
      newlyOverdue: diff.firstEver ? null : diff.newlyOverdue.length,
      statusChanged: diff.firstEver ? null : diff.statusChanged.length,
      scheduleChanged: diff.firstEver ? null : diff.scheduleChanged.length,
      budgetChanged: diff.firstEver ? null : diff.budgetChanged.length,
      firstEver: diff.firstEver,
      delivery,
      markdown,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "產生週報失敗" },
      { status: 500 }
    );
  }
}

/** 給人用瀏覽器確認端點活著,不需要金鑰。 */
export async function GET() {
  return NextResponse.json({
    name: "週報產生器",
    usage: "POST /api/reports/weekly?week=last|this|YYYY-MM-DD&deliver=1",
    auth: "Authorization: Bearer <API 金鑰>,或瀏覽器登入狀態",
    note: "一個人一週一份,同一週重跑會覆蓋。",
  });
}
