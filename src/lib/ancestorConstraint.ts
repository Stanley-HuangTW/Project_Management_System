import { CONSTRAINT_LABELS } from "@/lib/constraints";

export type ConstraintNode = {
  id: string;
  parentId: string | null;
  name: string;
  constraintType: "START_NO_EARLIER_THAN" | "FINISH_NO_LATER_THAN" | "MUST_FINISH_ON" | null;
  /** "YYYY-MM-DD" */
  constraintDate: string | null;
};

const MAX_LINES = 8;

/**
 * 子項目的時間超出上層(摘要)項目的日期約束的說明文字,一行一項;沒有超出就是空陣列。
 *
 * 上層設了「不得早於(開始)」,子項目的開始日不能比那天早;設了「不得晚於(完成)」或「必須完成於」,
 * 子項目的完成日不能比那天晚。edits 是「這次調整後」各項目的起訖日(被調整的項目,以及連動被推動的項目)。
 * 只提醒、不擋:跟其他日期約束一樣,期限是用來揭露問題的,不是把日期改寫掉。
 */
export function ancestorConstraintLines(nodes: ConstraintNode[], edits: { itemId: string; start: string; end: string }[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const edit of edits) {
    const item = byId.get(edit.itemId);
    if (!item) continue;
    let ancestor = item.parentId ? byId.get(item.parentId) : undefined;
    const visited = new Set<string>([item.id]);
    while (ancestor && !visited.has(ancestor.id)) {
      visited.add(ancestor.id);
      if (ancestor.constraintType && ancestor.constraintDate) {
        const label = `${CONSTRAINT_LABELS[ancestor.constraintType]} ${ancestor.constraintDate}`;
        let reason: string | null = null;
        if (ancestor.constraintType === "START_NO_EARLIER_THAN") {
          if (edit.start < ancestor.constraintDate) reason = `「${item.name}」的開始日 ${edit.start} 早於這天`;
        } else if (edit.end > ancestor.constraintDate) {
          reason = `「${item.name}」的完成日 ${edit.end} 晚於這天`;
        }
        const key = `${ancestor.id}|${item.id}`;
        if (reason && !seen.has(key)) {
          seen.add(key);
          lines.push(`・上層「${ancestor.name}」的日期約束「${label}」:${reason}`);
        }
      }
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
    }
  }
  if (lines.length > MAX_LINES) {
    const rest = lines.length - MAX_LINES;
    return [...lines.slice(0, MAX_LINES), `・…另外還有 ${rest} 項`];
  }
  return lines;
}
