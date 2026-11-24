import { getStatusOptions } from "@/types/column";

type StatusColumnLike = { id: string; type: string; name: string; options: unknown };

/**
 * 進度(% Done)填到 100% 時,這個項目的狀態要跟著變成「完成」。回傳要寫哪個狀態欄、哪個選項;找不到就 null。
 *
 * 狀態欄:看板報表設定的狀態欄;沒設就跟畫面一樣取名叫 Status 的、再不然第一個狀態欄。
 * 完成選項:報表設定裡對應「完成」的選項(那個欄位的);沒設定就用每個看板預設的 done,
 * 再不然名稱是 Completed / Done / 完成 的選項。
 */
export function doneStatusTarget(
  columns: StatusColumnLike[],
  reportStatusColumnId: string | null,
  reportDoneOptionIds: string[]
): { columnId: string; optionId: string; doneOptionIds: string[] } | null {
  const statusColumns = columns.filter((c) => c.type === "STATUS");
  const column =
    statusColumns.find((c) => c.id === reportStatusColumnId) ??
    statusColumns.find((c) => c.name === "Status") ??
    statusColumns[0];
  if (!column) return null;
  const options = getStatusOptions(column.options);
  const configured = column.id === reportStatusColumnId ? reportDoneOptionIds.filter((id) => options.some((o) => o.id === id)) : [];
  const byDefault = options.filter((o) => o.id === "done" || ["completed", "done", "完成"].includes(o.label.trim().toLowerCase()));
  const doneOptionIds = configured.length > 0 ? configured : byDefault.map((o) => o.id);
  if (doneOptionIds.length === 0) return null;
  return { columnId: column.id, optionId: doneOptionIds[0], doneOptionIds };
}
