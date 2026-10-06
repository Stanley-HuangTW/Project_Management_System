/**
 * 工時範本的純邏輯:檢查輸入、算套用到哪幾天。不碰資料庫,server action 與畫面共用。
 */
import { validateStartMinute } from "./timeOfDay";
import { addDaysIso } from "./timesheet";

/** 1 = 週一 … 7 = 週日(跟行事曆一週從週一開始一致)。 */
export const WEEKDAY_NAMES = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

export const MAX_TEMPLATE_NAME_LENGTH = 40;

/** 套用範本、複製上週的結果:建立了幾筆、幾筆本來就有(不重複建立)、哪些建不起來與原因。 */
export type ApplyResult = { created: number; existing: number; failed: string[] };

/** 結果的一句話說明,例如「建立 3 筆;另有 1 筆本來就有,沒有重複建立」。 */
export function describeApplyResult(r: ApplyResult): string {
  const parts = [`建立 ${r.created} 筆`];
  if (r.existing > 0) parts.push(`另有 ${r.existing} 筆本來就有,沒有重複建立`);
  if (r.failed.length > 0) parts.push(`${r.failed.length} 筆建立不起來`);
  return parts.join(";");
}

export type TemplateKind = "activity" | "project";

export type TemplateDraft = {
  name: string;
  kind: TemplateKind;
  categoryId: string | null;
  itemId: string | null;
  boardId: string | null;
  startMinute: number | null;
  hours: number;
  note: string;
  weekdays: number[];
  /** 管理者建立、大家都能用的共用範本。 */
  shared: boolean;
};

/** 回傳錯誤訊息,沒問題回 null。不檢查類別、工作項、專案存不存在(那要查資料庫)。 */
export function validateTemplateDraft(draft: TemplateDraft): string | null {
  const name = draft.name.trim();
  if (!name) return "請輸入範本名稱";
  if (name.length > MAX_TEMPLATE_NAME_LENGTH) return `範本名稱不要超過 ${MAX_TEMPLATE_NAME_LENGTH} 個字`;
  if (!Number.isFinite(draft.hours) || draft.hours <= 0) return "工時必須大於 0";
  if (draft.hours > 24) return "一天不會超過 24 小時";
  const startError = validateStartMinute(draft.startMinute, draft.hours);
  if (startError) return startError;
  if (draft.weekdays.length === 0) return "請至少選一天";
  if (draft.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return "星期不正確";
  if (draft.kind === "project") {
    if (draft.shared) return "共用範本不能指定工作項(工作項是各人被指派的)";
    if (!draft.itemId) return "請選擇工作項";
  } else {
    if (!draft.categoryId) return "請選擇類別";
  }
  return null;
}

/** 範本套用到某一週(weekStart 是那週的週一)時,要建立工時的日期,由早到晚、不重複。 */
export function templateDates(weekStart: string, weekdays: number[]): string[] {
  return [...new Set(weekdays)].sort((a, b) => a - b).map((d) => addDaysIso(weekStart, d - 1));
}

/** [1,3,5] → "週一、週三、週五";週一到週五 → "週一至週五";全部 → "每天"。 */
export function formatWeekdays(weekdays: number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.length === 7) return "每天";
  const consecutive = days.length >= 3 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive) return `${WEEKDAY_NAMES[days[0] - 1]}至${WEEKDAY_NAMES[days[days.length - 1] - 1]}`;
  return days.map((d) => WEEKDAY_NAMES[d - 1]).join("、");
}
