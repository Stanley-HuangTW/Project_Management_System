import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { diffWeeks, previousReportWeekStart, type WeeklyReportData } from "@/lib/weeklyReport";
import { WeeklyReportView } from "@/components/reports/WeeklyReportView";

/** 存的時候沒有驗證過型別(Json 欄位),讀回來時當舊版格式一律當「沒有資料」,
 *  不假裝畫得出分頁籤。 */
function asReportData(value: unknown): WeeklyReportData | null {
  const data = value as Partial<WeeklyReportData> | null;
  return data && Array.isArray(data.programs) ? (data as WeeklyReportData) : null;
}

export default async function WeeklyReportPage() {
  const session = await requireSession();

  // 只列自己的:週報看得到哪些看板是跟著人走的,別人的那一份涵蓋範圍不一樣。
  const reports = await prisma.weeklyReport.findMany({
    where: { userId: session.userId },
    orderBy: { weekStart: "desc" },
    take: 26,
    select: { weekStart: true, weekEnd: true, markdown: true, data: true, createdAt: true },
  });

  // 畫面要顯示「這週 vs 上週」的差異(新逾期/完成/風險新增…),但 diff 本身沒有
  // 存下來——用抓回來的這幾筆彼此互相比,跟產生週報當下用的是同一支純函式。
  const dataByWeekStart = new Map(reports.map((r) => [r.weekStart, asReportData(r.data)]));

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">週報</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        一週一份,涵蓋範圍跟你登入時看得到的看板一樣。「這週完成了什麼」以實際把狀態切成完成的時間為準(沒有切換紀錄的舊資料才拿這一份跟上一週那一份比);
        其他差異是拿這一份跟上一週那一份比出來的,所以第一份沒有那些差異數字。排程每週自動產一份,也可以在這裡手動補。
      </p>
      <WeeklyReportView
        reports={reports.map((r) => {
          const data = asReportData(r.data);
          const previous = dataByWeekStart.get(previousReportWeekStart(r.weekStart)) ?? null;
          return {
            weekStart: r.weekStart,
            weekEnd: r.weekEnd,
            markdown: r.markdown,
            createdAt: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
            data,
            diff: data
              ? diffWeeks(
                  { programs: data.programs, weekStart: data.weekStart, weekEnd: data.weekEnd },
                  previous ? { programs: previous.programs } : null
                )
              : null,
          };
        })}
      />
    </div>
  );
}
