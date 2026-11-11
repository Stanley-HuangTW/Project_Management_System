import type { CascadedItem, ConstraintConflict } from "@/lib/predecessorLink";

/**
 * 調整時程之前的確認視窗用的說明文字:這次調整會連動哪些工作項、哪些有「必須完成於」的會跟前置依賴衝突。
 * 甘特圖拖曳與項目卡片的「依實際完成日順延」共用。純函式。
 */

/** Enough of the knock-on list to judge the blast radius without turning the
 *  dialog into a wall of text. */
const MAX_CASCADE_LINES = 12;

/** The "and these move with it" section of the drag confirmation. */
export function describeCascade(cascaded: CascadedItem[]): string[] {
  if (cascaded.length === 0) return [];
  const shown = cascaded.slice(0, MAX_CASCADE_LINES);
  const lines = shown.map(
    (c) => `・${c.wbsCode} ${c.name}:${c.oldStart}~${c.oldEnd} → ${c.newStart}~${c.newEnd}`
  );
  if (cascaded.length > shown.length) {
    lines.push(`・…另外還有 ${cascaded.length - shown.length} 項`);
  }
  return ["", `依前置依賴連動,以下 ${cascaded.length} 個項目也會一起移動:`, ...lines];
}

/** The "this pushes a pinned item past its date" section of the same dialogs —
 *  a warning, not a block: the item stays on its 必須完成於 date, so the work
 *  would start before its predecessors are done. */
export function describeConflicts(conflicts: ConstraintConflict[]): string[] {
  if (conflicts.length === 0) return [];
  const shown = conflicts.slice(0, MAX_CASCADE_LINES);
  const lines = shown.map((c) => `・${c.wbsCode} ${c.name}:${c.short}`);
  if (conflicts.length > shown.length) {
    lines.push(`・…另外還有 ${conflicts.length - shown.length} 項`);
  }
  return [
    "",
    `⚠ 套用後,以下 ${conflicts.length} 個項目的「必須完成於」會跟前置依賴衝突(仍照約束排,會在前置依賴做完前就開始):`,
    ...lines,
  ];
}

