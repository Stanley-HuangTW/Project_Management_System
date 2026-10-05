import { requireSession } from "@/lib/session";
import { taipeiTodayIso } from "@/lib/timesheet";
import { TimesheetPage } from "@/components/timesheet/TimesheetPage";

export default async function TimesheetRoute() {
  await requireSession();

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">工時</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        登記專案工作項與非專案(會議、突發問題處理……)的工時。專案工時要主管核准才會計入成本報表;
        非專案工時登記即生效,不計入專案成本。
      </p>
      <TimesheetPage today={taipeiTodayIso()} />
    </div>
  );
}
