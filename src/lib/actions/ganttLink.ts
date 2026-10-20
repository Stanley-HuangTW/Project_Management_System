"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireItemBoardAccess } from "@/lib/boardAccess";
import { canManageStructure } from "@/lib/permissions";
import { upsertCellValue } from "@/lib/actions/cell";
import {
  buildWbsIndexFromItems,
  parsePredEntries,
  previewPredChange,
  type CascadedItem,
  type ConstraintConflict,
} from "@/lib/predecessorLink";
import { validateNewLink } from "@/lib/ganttLink";

/**
 * 甘特圖上建立 / 修改 / 刪除前置連結:改的是「後續任務」那一格 Pred 的值,走既有的欄位儲存
 * (upsertCellValue),所以通知、稽核紀錄、webhook 與排程重算都跟在項目卡片改 Pred 時一模一樣。
 * 權限也一樣:Pred 是文字欄位,只有管理者與主管能改。
 *
 * 錯誤一律用回傳值帶回去,不用丟例外——production 的 Next.js 會把丟出來的訊息洗成一句通用的話。
 */

export type GanttLinkPreview = {
  error?: string;
  /** 後續任務自己的日期:現在的與連結之後的。after 是 null = 算不出來(例如前置還沒有日期)。 */
  before: { start: string; end: string } | null;
  after: { start: string; end: string } | null;
  /** 後續任務的日期一變,連帶被推動的其他項目。 */
  cascade: CascadedItem[];
  /** 連結之後,哪些被釘住「必須完成於」的項目會跟前置依賴衝突(原本沒有、或變得更嚴重的)。 */
  conflicts: ConstraintConflict[];
};

const failPreview = (error: string): GanttLinkPreview => ({
  error,
  before: null,
  after: null,
  cascade: [],
  conflicts: [],
});

type Prepared =
  | { ok: false; error: string }
  | {
      ok: true;
      boardId: string;
      predColumnId: string;
    };

/** 共用的前置:權限、載入整個看板、檢查這次「新加的」依賴合不合理。 */
async function prepare(succId: string, nextValue: string | null): Promise<Prepared> {
  const session = await requireSession();
  if (nextValue !== null && typeof nextValue !== "string") return { ok: false, error: "前置依賴的值不正確" };
  const boardId = await requireItemBoardAccess(succId, session);
  if (!canManageStructure(session.role)) {
    return { ok: false, error: "權限不足:建立或修改前置連結需要管理者或主管權限(跟編輯 Pred 欄位一樣)" };
  }

  const [board, items] = await Promise.all([
    prisma.board.findUnique({ where: { id: boardId }, select: { predColumnId: true } }),
    prisma.item.findMany({
      where: { boardId, deletedAt: null },
      select: { id: true, parentId: true, order: true, groupId: true, cellValues: { select: { columnId: true, value: true } } },
    }),
  ]);
  if (!board?.predColumnId) return { ok: false, error: "這個看板沒有 Pred 欄位,無法建立前置連結" };
  const predColumnId = board.predColumnId;
  const succ = items.find((i) => i.id === succId);
  if (!succ) return { ok: false, error: "找不到這個項目(可能已被刪除)" };

  const index = buildWbsIndexFromItems(items);
  const current = parsePredEntries(index, succ.groupId, succ.cellValues.find((cv) => cv.columnId === predColumnId)?.value);
  const next = parsePredEntries(index, succ.groupId, nextValue);
  // 只檢查這次新加的;原本就有的依賴(含跨看板的)維持原樣,不重新審查。
  for (const entry of next) {
    if (current.some((c) => c.itemId === entry.itemId)) continue;
    const problem = validateNewLink(items, predColumnId, entry.itemId, succId, index);
    if (problem) return { ok: false, error: problem };
  }
  return { ok: true, boardId, predColumnId };
}

/** 唯讀:這個 Pred 值存下去,後續任務與被連動的項目會怎麼變——給確認視窗講清楚用。照真的排程引擎算(逐條關係與延遲)。 */
export async function previewGanttLink(succId: string, nextValue: string | null): Promise<GanttLinkPreview> {
  const prep = await prepare(succId, nextValue);
  if (!prep.ok) return failPreview(prep.error);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const preview = await previewPredChange(prep.boardId, succId, prep.predColumnId, nextValue);
  if (!preview) return { before: null, after: null, cascade: [], conflicts: [] };
  return {
    before: preview.before ? { start: iso(preview.before.start), end: iso(preview.before.end) } : null,
    after: preview.after ? { start: iso(preview.after.start), end: iso(preview.after.end) } : null,
    cascade: preview.cascaded,
    conflicts: preview.conflicts,
  };
}

/** 把後續任務的 Pred 存成 nextValue(null = 整格清空)。 */
export async function setGanttLink(succId: string, nextValue: string | null): Promise<{ error?: string }> {
  const prep = await prepare(succId, nextValue);
  if (!prep.ok) return { error: prep.error };
  const result = await upsertCellValue(prep.boardId, succId, prep.predColumnId, nextValue);
  return result && "error" in result && result.error ? { error: String(result.error) } : {};
}
