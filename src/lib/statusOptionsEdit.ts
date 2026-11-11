import type { StatusOption } from "@/types/column";

/**
 * 狀態欄位選項的新增 / 改名 / 刪除:存檔前的檢查。純函式,不碰資料庫與畫面。
 *
 * 選項的 id 是穩定的(格子裡存的是 id,不是名字),所以改名、改顏色不影響已經選了它的工作項;
 * 刪掉一個選項則會讓選了它的格子變成空白,所以還有人在用的不能刪(要先改成別的狀態)。
 */

export const MAX_STATUS_OPTIONS = 30;
export const MAX_STATUS_LABEL = 20;

/** 報表分類(跟「報表設定」同一組):進行中是「沒有歸到其他類」的預設,不需要存。 */
export const REPORT_BUCKETS = [
  { key: "notStarted", label: "尚未處理" },
  { key: "planned", label: "計畫中" },
  { key: "inProgress", label: "進行中" },
  { key: "paused", label: "暫停" },
  { key: "stuck", label: "卡住" },
  { key: "done", label: "已完成" },
] as const;
export type ReportBucketKey = (typeof REPORT_BUCKETS)[number]["key"];

/** 新狀態選項的代號(畫面上按「新增狀態」時產生)。 */
export function newStatusId(): string {
  return `s${Math.random().toString(36).slice(2, 10)}`;
}

const COLOR_RE =/^#[0-9a-f]{6}$/i;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export type StatusEditResult =
  | { error: string }
  | {
      value: StatusOption[];
      /** 這次拿掉的選項 id。 */
      removedIds: string[];
      /** 這次新增的選項 id。 */
      addedIds: string[];
    };

export function validateStatusOptions(raw: unknown, previous: readonly StatusOption[]): StatusEditResult {
  if (!Array.isArray(raw)) return { error: "狀態選項的格式不對" };
  if (raw.length === 0) return { error: "至少要留一個狀態" };
  if (raw.length > MAX_STATUS_OPTIONS) return { error: `狀態太多了(最多 ${MAX_STATUS_OPTIONS} 個)` };

  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const value: StatusOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { error: "狀態選項的格式不對" };
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const label = (typeof r.label === "string" ? r.label : "").trim();
    const color = typeof r.color === "string" ? r.color : "";
    if (!ID_RE.test(id) || seenIds.has(id)) return { error: "狀態的代號不正確" };
    if (!label) return { error: "狀態名稱不可為空" };
    if (label.length > MAX_STATUS_LABEL) return { error: `狀態名稱太長了(上限 ${MAX_STATUS_LABEL} 字):${label.slice(0, 8)}…` };
    if (seenLabels.has(label.toLowerCase())) return { error: `已經有一個叫「${label}」的狀態` };
    if (!COLOR_RE.test(color)) return { error: `「${label}」的顏色不正確` };
    seenIds.add(id);
    seenLabels.add(label.toLowerCase());
    value.push({ id, label, color });
  }
  const before = new Set(previous.map((o) => o.id));
  return {
    value,
    removedIds: previous.filter((o) => !seenIds.has(o.id)).map((o) => o.id),
    addedIds: value.filter((o) => !before.has(o.id)).map((o) => o.id),
  };
}

/** 報表分類的五個名單(進行中不用存):拿掉被刪的選項,新增的選項依選的分類放進去。 */
export type BucketLists = Record<Exclude<ReportBucketKey, "inProgress">, string[]>;

export function updateBucketLists(
  lists: BucketLists,
  removedIds: readonly string[],
  placements: Readonly<Record<string, ReportBucketKey>>
): BucketLists {
  const removed = new Set(removedIds);
  const next: BucketLists = {
    notStarted: lists.notStarted.filter((id) => !removed.has(id)),
    planned: lists.planned.filter((id) => !removed.has(id)),
    paused: lists.paused.filter((id) => !removed.has(id)),
    stuck: lists.stuck.filter((id) => !removed.has(id)),
    done: lists.done.filter((id) => !removed.has(id)),
  };
  for (const [id, bucket] of Object.entries(placements)) {
    if (bucket === "inProgress" || removed.has(id)) continue;
    if (!Object.values(next).some((list) => list.includes(id))) next[bucket].push(id);
  }
  return next;
}
