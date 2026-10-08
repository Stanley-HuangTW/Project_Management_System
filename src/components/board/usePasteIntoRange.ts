"use client";

import { useRouter } from "next/navigation";
import { useDialogs } from "@/components/ui/DialogProvider";
import { pasteCellValues, type PasteCellEntry } from "@/lib/actions/paste";
import { parseClipboardTable } from "@/lib/clipboardTable";
import { sameJson, type UndoResult } from "@/lib/editHistory";
import { MAX_PASTE_ROWS, columnPasteSkipReason, planColumnReplace } from "@/lib/pasteValues";
import type { BoardWithData, UserOption } from "@/types/board";
import type { CellValueJson } from "@/types/column";
import { useEditHistory, type EditHistoryApi } from "./EditHistoryProvider";
import type { CellRange } from "./useCellRangeSelection";

/** 每一批送多少格給伺服器(一格一格套用規則,太多一次跑會太久)。 */
const PASTE_BATCH = 60;

function storedValue(board: BoardWithData, itemId: string, columnId: string): CellValueJson {
  const item = board.items.find((i) => i.id === itemId);
  return (item?.cellValues.find((c) => c.columnId === columnId)?.value ?? null) as CellValueJson;
}

/** 分批寫入;回傳成功的與失敗的(含原因)。 */
async function writeInBatches(boardId: string, entries: PasteCellEntry[]) {
  const applied: PasteCellEntry[] = [];
  const failed: { itemId: string; error: string }[] = [];
  for (let i = 0; i < entries.length; i += PASTE_BATCH) {
    const result = await pasteCellValues(boardId, entries.slice(i, i + PASTE_BATCH));
    applied.push(...result.applied);
    failed.push(...result.failed.map((f) => ({ itemId: f.itemId, error: f.error })));
    if (result.error) {
      failed.push(...entries.slice(i).map((e) => ({ itemId: e.itemId, error: result.error! })));
      break;
    }
  }
  return { applied, failed };
}

/**
 * 還原 / 重做一次貼上:每一格目前存的值都還是當初貼完(或貼之前)的值才寫,有任何一格被改過就整個擋下來,
 * 不蓋掉別人的修改——跟單格修改的上一步 / 下一步同一個規則。
 */
async function rewriteIfUnchanged(
  history: EditHistoryApi,
  boardId: string,
  columnId: string,
  expected: Map<string, CellValueJson>,
  write: PasteCellEntry[]
): Promise<UndoResult> {
  const board = history.getBoard();
  for (const entry of write) {
    if (!board.items.some((i) => i.id === entry.itemId)) {
      return { ok: false, reason: "貼上的項目裡有已經不存在的,沒有執行。" };
    }
    if (!sameJson(storedValue(board, entry.itemId, columnId), expected.get(entry.itemId) ?? null)) {
      return {
        ok: false,
        reason: "貼上的格子裡有已經被改過的(可能是其他人或其他分頁),為了不蓋掉新的修改,沒有執行。",
      };
    }
  }
  try {
    const { failed } = await writeInBatches(boardId, write);
    if (failed.length > 0) return { ok: false, reason: `有 ${failed.length} 格沒有成功:${failed[0].error}` };
    return { ok: true };
  } catch {
    return { ok: false, reason: "儲存失敗,請重新整理後再試一次。" };
  }
}

/**
 * 在表格框選一欄的一段儲存格之後按 Ctrl+V:把貼上的每一行(取第一欄)換進那幾格。
 * 先說明會換成什麼讓人確認;轉不過去、被鎖住、沒權限的格子略過並回報原因;成功的記進「上一步 / 下一步」。
 * 回傳 true 代表這次貼上處理完了(呼叫端可以取消框選);取消確認或無法貼上時回 false。
 */
export function usePasteIntoRange({ board, users }: { board: BoardWithData; users: UserOption[] }) {
  const router = useRouter();
  const { notify, confirm } = useDialogs();
  const history = useEditHistory();

  return async function pasteIntoRange(range: CellRange, text: string): Promise<boolean> {
    const column = board.columns.find((c) => c.id === range.columnId);
    if (!column) return false;
    const skip = columnPasteSkipReason(column, { predColumnId: board.predColumnId });
    if (skip) {
      await notify(skip, { title: `「${column.name}」不能貼上` });
      return false;
    }

    // 試算表複製的範圍可能有好幾欄;框選的只有一欄,取第一欄。
    const lines = parseClipboardTable(text).map((row) => row[0] ?? "");
    if (lines.length === 0) return false;
    if (lines.length > MAX_PASTE_ROWS) {
      await notify(`一次最多貼上 ${MAX_PASTE_ROWS} 行(你貼了 ${lines.length} 行),請分幾次貼。`, { title: "貼上的內容太多" });
      return false;
    }

    const parentIds = new Set(board.items.map((i) => i.parentId).filter((id): id is string => !!id));
    const itemById = new Map(board.items.map((i) => [i.id, i]));
    const targets = range.itemIds.map((itemId) => ({
      itemId,
      name: itemById.get(itemId)?.name ?? "",
      // 有子項目的項目,進度是子項目統計出來的,格子本來就不能手動改。
      skipReason: column.id === board.progressColumnId && parentIds.has(itemId) ? "有子項目,進度由子項目統計" : null,
    }));
    const plan = planColumnReplace({
      column: { id: column.id, name: column.name, type: column.type, options: column.options },
      targets,
      lines,
      ctx: { users, progressColumnId: board.progressColumnId },
    });

    if (plan.entries.length === 0) {
      await notify(
        ["沒有任何一格可以貼上。", ...(plan.note ? [plan.note] : []), ...plan.problems.slice(0, 8).map((p) => `• ${p}`)].join("\n"),
        { title: "無法貼上" }
      );
      return true;
    }

    const fillAll = lines.length === 1 && targets.length > 1;
    const preview = targets
      .slice(0, 5)
      .map((t, i) => `• ${t.name} → ${(fillAll ? lines[0] : lines[i] ?? "").trim() || "(清空)"}`);
    const message = [
      `要把「${column.name}」欄框選的 ${targets.length} 格,換成貼上的內容嗎?`,
      "",
      ...preview,
      ...(targets.length > 5 ? [`……還有 ${targets.length - 5} 格`] : []),
      ...(plan.note ? ["", plan.note] : []),
      ...(plan.problems.length > 0 ? ["", `有 ${plan.problems.length} 格轉不過去或不能貼,那些格子不會動。`] : []),
      "",
      "貼上之後可以按「上一步」復原。",
    ].join("\n");
    if (!(await confirm(message, { title: "貼上取代", confirmLabel: "貼上" }))) return false;

    const before = new Map<string, CellValueJson>();
    const latest = history?.getBoard() ?? board;
    for (const e of plan.entries) before.set(e.itemId, storedValue(latest, e.itemId, column.id));

    let result: Awaited<ReturnType<typeof writeInBatches>>;
    try {
      result = await writeInBatches(board.id, plan.entries.map((e) => ({ itemId: e.itemId, columnId: column.id, value: e.value })));
    } catch {
      await notify("貼上失敗,請重新整理後再試一次。", { title: "無法貼上" });
      router.refresh();
      return true;
    }
    router.refresh();

    if (history && result.applied.length > 0) {
      const after = new Map(result.applied.map((a) => [a.itemId, a.value]));
      const undoEntries = result.applied.map((a) => ({ itemId: a.itemId, columnId: column.id, value: before.get(a.itemId) ?? null }));
      history.record({
        label: `貼上「${column.name}」${result.applied.length} 格`,
        undo: () => rewriteIfUnchanged(history, board.id, column.id, after, undoEntries),
        redo: () => rewriteIfUnchanged(history, board.id, column.id, before, result.applied),
      });
    }

    const problems = [
      ...plan.problems,
      ...result.failed.map((f) => `「${itemById.get(f.itemId)?.name ?? ""}」:${f.error}`),
    ];
    if (problems.length > 0 || plan.note) {
      await notify(
        [
          `已貼上 ${result.applied.length} 格。`,
          ...(plan.note ? ["", plan.note] : []),
          ...(problems.length > 0
            ? ["", `有 ${problems.length} 格沒有貼成:`, ...problems.slice(0, 10).map((p) => `• ${p}`), ...(problems.length > 10 ? [`……還有 ${problems.length - 10} 格`] : [])]
            : []),
        ].join("\n"),
        { title: "貼上完成,但有些沒成功" }
      );
    }
    return true;
  };
}
