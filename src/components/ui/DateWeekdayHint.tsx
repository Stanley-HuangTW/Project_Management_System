import { weekdayOf } from "@/lib/weekdayLabel";

/**
 * 日期輸入框(瀏覽器的 <input type="date"> 沒辦法塞星期幾)下面的一行小字「週四」。
 * value 是 YYYY-MM-DD;空的或不是日期就什麼都不畫。跟項目卡片 DateCell 同一個樣子。
 */
export function DateWeekdayHint({ value, className = "" }: { value: string | null | undefined; className?: string }) {
  const weekday = value ? weekdayOf(value) : "";
  if (!weekday) return null;
  return (
    <span data-date-weekday className={`block px-2 pt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500 ${className}`}>
      ({weekday})
    </span>
  );
}
