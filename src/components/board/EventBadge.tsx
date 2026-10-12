import type { EventTone } from "@/lib/itemEvents";
import { NOTIFICATION_TYPE_STYLES } from "@/components/notifications/typeStyles";

const NEUTRAL_BADGE = "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";

/** 標籤顏色:跟通知列表同一組(修改藍、指派紫、留言黃);連結與待辦事項沒有對應的通知,用中性色。 */
export function eventBadgeClass(tone: EventTone): string {
  return tone === "NEUTRAL" ? NEUTRAL_BADGE : NOTIFICATION_TYPE_STYLES[tone].className;
}

/** 更新記錄的類型標籤(修改 / 指派 / 留言 / 連結 / 待辦事項)。 */
export function EventBadge({ label, tone }: { label: string; tone: EventTone }) {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-4 ${eventBadgeClass(tone)}`}>{label}</span>
  );
}
