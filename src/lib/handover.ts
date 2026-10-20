import { classifyStatusOption } from "@/lib/itemEvents";

/**
 * 工作交接(使用者管理):把一個人名下還沒做完的工作交給另一個人。
 * 這裡是不碰資料庫的純函式,伺服器端與測試共用。
 */

/** 人員欄位的值(單一個人的字串,或將來的陣列)裡,把 fromId 換成 toId;接手的人已經在裡面就只拿掉 fromId,不重複。 */
export function replacePersonValue(value: unknown, fromId: string, toId: string): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const v of value) {
      const next = v === fromId ? toId : v;
      if (!out.includes(next)) out.push(next);
    }
    return out;
  }
  return value === fromId ? toId : value;
}

/** 接手的人本來就在這個工作項的人員分配裡:投入 % 加總,上限 100。 */
export function mergeAllocationPct(targetPct: number, sourcePct: number): number {
  return Math.min(100, targetPct + sourcePct);
}

/** 現在是台灣時間的哪個月:「2026-10」。 */
export function currentMonthTaipei(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 7);
}

/**
 * 人力名額還要不要交接:還有這個月以後的投入(或根本沒排月份)就算進行中;
 * 整個都在過去的月份,是已經發生的人力成本,留在原來的人名下。
 */
export function slotIsOngoing(months: string[], currentMonth: string): boolean {
  return months.length === 0 || months.some((month) => month >= currentMonth);
}

/**
 * 這個工作項還沒完成:狀態欄選的選項不是「完成」(報表設定指定的完成選項、預設的 done,或標籤叫完成 / Done…)。
 * 沒有狀態欄、或還沒選狀態,都算還沒完成。
 */
export function isUnfinished(
  statusValue: unknown,
  options: { id: string; label: string }[],
  doneOptionIds: string[]
): boolean {
  const option = options.find((o) => o.id === statusValue);
  return !(option && classifyStatusOption(option, doneOptionIds) === "done");
}
