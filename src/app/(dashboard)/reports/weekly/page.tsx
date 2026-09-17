import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { WeeklyReportView } from "@/components/reports/WeeklyReportView";

export default async function WeeklyReportPage() {
  const session = await requireSession();

  // 只列自己的:週報看得到哪些看板是跟著人走的,別人的那一份涵蓋範圍不一樣。
  const reports = await prisma.weeklyReport.findMany({
    where: { userId: session.userId },
    orderBy: { weekStart: "desc" },
    take: 26,
    select: { weekStart: true, weekEnd: true, markdown: true, createdAt: true },
  });

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">週報</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        一週一份,涵蓋範圍跟你登入時看得到的看板一樣。「這週完成了什麼」是拿這一份跟上一週那一份比出來的,
        所以第一份不會有差異數字。排程每週自動產一份,也可以在這裡手動補。
      </p>
      <WeeklyReportView
        reports={reports.map((r) => ({
          weekStart: r.weekStart,
          weekEnd: r.weekEnd,
          markdown: r.markdown,
          createdAt: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
        }))}
      />
    </div>
  );
}
