import { taipeiDateOf } from "@/lib/itemEvents";

/**
 * 實際完成比預定完成晚:預定 5/20 完成、卻在 5/30 才切成完成——前置依賴(FS)的後續工作項會跟著晚,
 * PM 要看得到「晚了幾天」,並決定要不要把後續順延。純函式。
 *
 * plannedEndIso 是這個工作項目前排的結束日(Finish,yyyy-MM-dd);completedAtIso 是它切成完成的時間(台灣時間算日期)。
 * 沒有晚(同一天或更早)、或缺資料,回 null。基準線(原計畫)不受影響,所以事後仍可跟原計畫比。
 */
export function lateFinishOf(
  plannedEndIso: string | null | undefined,
  completedAtIso: string | null | undefined
): { plannedEnd: string; actualDate: string; daysLate: number } | null {
  if (!plannedEndIso || !completedAtIso) return null;
  const plannedEnd = plannedEndIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedEnd)) return null;
  const actualDate = taipeiDateOf(completedAtIso);
  const daysLate = Math.round((Date.parse(`${actualDate}T00:00:00Z`) - Date.parse(`${plannedEnd}T00:00:00Z`)) / 86_400_000);
  return daysLate > 0 ? { plannedEnd, actualDate, daysLate } : null;
}
