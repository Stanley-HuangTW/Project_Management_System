import type { ApprovalStatus } from "@prisma/client";
import type { ActivityDayEntry, MyWeek, ProjectDayEntry } from "@/lib/actions/activityTime";

/** 行事曆上的一筆工時:專案工作項的工時或會議/出差等其他工時,畫面不必分兩套。 */
export type CalendarEvent = {
  key: string;
  kind: "project" | "activity";
  id: string;
  date: string;
  /** 一天中的開始時間(分鐘);null = 沒排時間,畫在日期底下的「未排時間」。 */
  startMinute: number | null;
  hours: number;
  title: string;
  subtitle: string;
  status: ApprovalStatus;
  /** 要經過核准才計入成本的(專案工時、對應專案的會議);其他登記即生效。 */
  needsApproval: boolean;
  project?: ProjectDayEntry;
  activity?: ActivityDayEntry;
};

export function eventsOfWeek(week: MyWeek): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const day of week.days) {
    for (const e of day.project) {
      events.push({
        key: `p:${e.id}`,
        kind: "project",
        id: e.id,
        date: day.date,
        startMinute: e.startMinute,
        hours: e.hours,
        title: e.itemName,
        subtitle: [e.boardName, e.note].filter(Boolean).join(" · "),
        status: e.status,
        needsApproval: true,
        project: e,
      });
    }
    for (const e of day.activity) {
      events.push({
        key: `a:${e.id}`,
        kind: "activity",
        id: e.id,
        date: day.date,
        startMinute: e.startMinute,
        hours: e.hours,
        title: e.categoryName,
        subtitle: [e.boardName, e.riskTitle ? `議題:${e.riskTitle}` : "", e.note].filter(Boolean).join(" · "),
        status: e.status,
        needsApproval: e.boardId !== null,
        activity: e,
      });
    }
  }
  return events;
}

/**
 * 拖曳、拉長後先在畫面上套用新的位置(伺服器儲存成功後會重新讀取;失敗也會重新讀取而還原)。
 * 只動日期、開始時間與時數,審核狀態等由伺服器決定。
 */
export function moveEventInWeek(
  week: MyWeek,
  event: CalendarEvent,
  change: { date: string; startMinute: number | null; hours: number }
): MyWeek {
  const days = week.days.map((day) => ({
    ...day,
    project: day.project.filter((e) => !(event.kind === "project" && e.id === event.id)),
    activity: day.activity.filter((e) => !(event.kind === "activity" && e.id === event.id)),
  }));
  const target = days.find((d) => d.date === change.date);
  if (target) {
    if (event.project) target.project.push({ ...event.project, ...change });
    if (event.activity) target.activity.push({ ...event.activity, ...change });
  }
  return { ...week, days };
}

/** 這一天的合計小時:被退回的不算(跟一天 24 小時上限同一個規則)。 */
export function dayTotalHours(events: CalendarEvent[], date: string): number {
  return events.filter((e) => e.date === date && e.status !== "REJECTED").reduce((sum, e) => sum + e.hours, 0);
}
