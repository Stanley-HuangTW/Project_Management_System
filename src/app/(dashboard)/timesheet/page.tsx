import { requireSession } from "@/lib/session";
import { taipeiTodayIso } from "@/lib/timesheet";
import { TimesheetPage } from "@/components/timesheet/TimesheetPage";

export default async function TimesheetRoute() {
  await requireSession();

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">工時</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        {"在週行事曆上排工時:點一下或拖出一段時間新增,拖曳整塊換時間或換天,拖下緣改時數。專案工作項的工時、以及對應專案的會議,要由核准人核准才計入該專案的成本;其他(部門週會、請假、出差……)登記即生效。"}
      </p>
      <TimesheetPage today={taipeiTodayIso()} />
    </div>
  );
}
