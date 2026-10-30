"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { planMoveToParent, subtreeIdsOf, type MovePosition } from "@/lib/bulkStructure";
import { computeWbsCodes } from "@/lib/wbs";
import {
  listBulkTargetBoards,
  loadBulkTargetTree,
  type BulkTargetBoard,
  type BulkTargetItem,
} from "@/lib/actions/bulkCrossBoard";
import type { BoardWithData } from "@/types/board";
import { ItemTreePicker } from "./ItemTreePicker";
import { knownErrorMessage } from "@/lib/userError";

/** position 只有「同看板移動」會用到:複製與跨看板一律接在目標底下現有項目的最後面。 */
export type BulkTarget = { boardId: string; groupId: string; parentId: string | null; position?: MovePosition };

const POSITION_END = "__end__";
const POSITION_START = "__start__";

const selectClass =
  "w-full rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

/**
 * 複製 / 移動要放到哪裡:任何一個你可以新增項目的看板、其中任何分組裡的任何項目底下,或某個分組的
 * 最上層。同一個看板內被勾選的項目(連同子項目)不能當目標——放進自己底下沒有意義。
 */
export function BulkTargetDialog({
  mode,
  board,
  rootIds,
  totalCount,
  busy,
  onConfirm,
  onClose,
}: {
  mode: "copy" | "move";
  board: BoardWithData;
  rootIds: string[];
  /** 連同子項目一共幾個。 */
  totalCount: number;
  busy: boolean;
  onConfirm: (target: BulkTarget) => void;
  onClose: () => void;
}) {
  // 預設放在第一個被選項目現在的位置——複製等於「就地再來一份」,移動則要自己改。
  const first = board.items.find((i) => i.id === rootIds[0]);
  const [targetBoardId, setTargetBoardId] = useState(board.id);
  const [groupId, setGroupId] = useState(first?.groupId ?? board.groups[0]?.id ?? "");
  const [parentId, setParentId] = useState(first?.parentId ?? "");

  // 其他看板:可以放進去的看板清單,選了別的看板才去載入它的項目樹。
  const [boards, setBoards] = useState<BulkTargetBoard[] | null>(null);
  const [tree, setTree] = useState<{ boardId: string; items: BulkTargetItem[]; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listBulkTargetBoards();
        if (!cancelled) setBoards(list);
      } catch {
        if (!cancelled) setBoards([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (targetBoardId === board.id) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await loadBulkTargetTree(targetBoardId);
        if (!cancelled) setTree({ boardId: targetBoardId, items: result.items, error: result.error });
      } catch (err) {
        if (!cancelled) setTree({ boardId: targetBoardId, items: [], error: knownErrorMessage(err, "載入目標看板失敗") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetBoardId, board.id]);

  const crossBoard = targetBoardId !== board.id;
  const targetBoard = boards?.find((b) => b.id === targetBoardId);
  const targetGroups = crossBoard ? (targetBoard?.groups ?? []) : board.groups;
  const treeReady = !crossBoard || tree?.boardId === targetBoardId;
  const targetItems = useMemo<{ id: string; name: string; parentId: string | null; order: number; groupId: string }[]>(
    () => (crossBoard ? (tree?.boardId === targetBoardId ? tree.items : []) : board.items),
    [crossBoard, tree, targetBoardId, board.items]
  );

  // 同看板時,被勾選的子樹不能當目標;別的看板沒有這個限制。
  const excluded = useMemo(
    () => (crossBoard ? new Set<string>() : subtreeIdsOf(board.items, rootIds)),
    [crossBoard, board.items, rootIds]
  );
  const groupItems = useMemo(() => targetItems.filter((i) => i.groupId === groupId), [targetItems, groupId]);
  // 編號要照整個分組算,才跟畫面上看到的一致;可選的清單則扣掉被選的子樹。
  const wbsByItemId = useMemo(() => computeWbsCodes(groupItems), [groupItems]);
  const pickable = useMemo(() => groupItems.filter((i) => !excluded.has(i.id)), [groupItems, excluded]);

  // 同看板移動時可以決定插在新父層的哪個位置(也就是 WBS 編號的順序)。選項是新父層底下現有的
  // 項目(扣掉被搬的):「接在它後面」;再加上最前面、最後面。
  const [positionValue, setPositionValue] = useState(POSITION_END);
  const siblings = useMemo(
    () =>
      groupItems
        .filter((i) => i.parentId === (parentId || null) && !excluded.has(i.id))
        .sort((a, b) => a.order - b.order),
    [groupItems, parentId, excluded]
  );
  const showPosition = mode === "move" && !crossBoard;
  const position: MovePosition | undefined =
    !showPosition || positionValue === POSITION_END
      ? undefined
      : { afterId: positionValue === POSITION_START ? null : positionValue };

  // 套用之後被搬項目的新 WBS 編號——跟實際搬完看到的是同一套算法。
  const resultingCodes = useMemo(() => {
    if (!showPosition) return null;
    const plan = planMoveToParent(board.items, rootIds, parentId || null, groupId, position);
    if (!plan.ok) return null;
    const writes = new Map(plan.writes.map((w) => [w.id, w]));
    const moved = board.items
      .map((i) => {
        const w = writes.get(i.id);
        return w ? { ...i, parentId: w.parentId, order: w.order, groupId: w.groupId } : i;
      })
      .filter((i) => i.groupId === groupId);
    const codes = computeWbsCodes(moved);
    return rootIds.map((id) => ({ id, code: codes.get(id) ?? "", name: board.items.find((i) => i.id === id)?.name ?? "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPosition, board.items, rootIds, parentId, groupId, positionValue]);

  const group = targetGroups.find((g) => g.id === groupId);
  const parent = parentId ? targetItems.find((i) => i.id === parentId) : undefined;
  const verb = mode === "copy" ? "複製" : "移動";
  const boardLabel = crossBoard ? `${targetBoard?.name ?? ""} › ` : "";
  const where = `${boardLabel}${group?.name ?? ""} › ${parent ? `${wbsByItemId.get(parent.id) ?? ""} ${parent.name}`.trim() : "最上層"}`;

  function changeBoard(nextBoardId: string) {
    setTargetBoardId(nextBoardId);
    const groups = nextBoardId === board.id ? board.groups : (boards?.find((b) => b.id === nextBoardId)?.groups ?? []);
    setGroupId(groups[0]?.id ?? "");
    setParentId("");
    setPositionValue(POSITION_END);
  }

  return (
    <Modal open onOpenChange={(open) => !open && !busy && onClose()} title={`${verb}到…`}>
      <div className="space-y-4 text-sm text-neutral-700 dark:text-neutral-200">
        <p>
          已選 {rootIds.length} 項(含子項目共 {totalCount} 項)。
        </p>

        {boards && boards.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">看板</span>
            <select
              value={targetBoardId}
              disabled={busy}
              onChange={(e) => changeBoard(e.target.value)}
              className={selectClass}
            >
              {/* 目前這個看板永遠排第一,就算清單裡沒有它(例如只能放進別的看板的人)。 */}
              <option value={board.id}>{board.name}(目前這個看板)</option>
              {boards
                .filter((b) => b.id !== board.id)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">分組</span>
          <select
            value={groupId}
            disabled={busy || !treeReady}
            onChange={(e) => {
              setGroupId(e.target.value);
              setParentId("");
              setPositionValue(POSITION_END);
            }}
            className={selectClass}
          >
            {targetGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">目標父項目</span>
          <ItemTreePicker
            items={pickable}
            wbsByItemId={wbsByItemId}
            value={parentId}
            onChange={(id) => {
              setParentId(id);
              setPositionValue(POSITION_END);
            }}
            placeholder={treeReady ? "(分組最上層)" : "載入中…"}
            disabled={busy || !treeReady}
            className="flex w-full items-center justify-between gap-1 rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-left text-sm outline-none focus:border-blue-500 disabled:opacity-50"
          />
          {crossBoard && tree?.boardId === targetBoardId && tree.error && (
            <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{tree.error}</span>
          )}
        </div>

        {showPosition && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
              位置(決定 WBS 編號的順序)
            </span>
            <select
              value={positionValue}
              disabled={busy}
              onChange={(e) => setPositionValue(e.target.value)}
              className={selectClass}
            >
              <option value={POSITION_END}>放在最後面</option>
              <option value={POSITION_START}>放在最前面</option>
              {siblings.map((sibling) => (
                <option key={sibling.id} value={sibling.id}>
                  接在「{wbsByItemId.get(sibling.id) ?? ""} {sibling.name}」後面
                </option>
              ))}
            </select>
            {resultingCodes && resultingCodes.length > 0 && (
              <span className="mt-1 block text-xs text-blue-700 dark:text-blue-300">
                移動後的編號:
                {resultingCodes
                  .slice(0, 4)
                  .map((r) => `${r.code} ${r.name}`)
                  .join("、")}
                {resultingCodes.length > 4 && ` …等 ${resultingCodes.length} 項`}
              </span>
            )}
          </label>
        )}

        <p className="rounded-md bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300">
          {crossBoard
            ? mode === "copy"
              ? "複製到別的看板:欄位值依「欄位名稱 + 類型」對應到目標看板(狀態等選項依名稱對應),對不上的欄位會略過,完成後會告訴你略過了哪些。前置依賴只保留這次一起複製的項目之間的,指到範圍外的會清掉。接在目標底下現有項目的最後面。不含指派人員、留言、附件與待辦。"
              : "移動到別的看板:項目連同子項目真的搬過去,留言、附件、連結、待辦、工時、更新記錄、指派都跟著走,接在目標底下現有項目的最後面。欄位值依「欄位名稱 + 類型」對應,對不上的會略過;前置依賴只保留這次一起搬的項目之間的,別的項目指到它們的前置也會清掉;樣機使用紀錄會清掉。有已下單、支出、預算紀錄的項目不能搬,請改用複製。"
            : mode === "copy"
              ? "複製會帶走欄位值(日期、狀態、負責人欄位等)與所有子項目,接在目標底下現有項目的最後面。前置依賴:指到這次一起複製的項目,會改指新的複本;指到範圍外的維持不變。不含指派人員、留言、附件與待辦。"
              : "移動會連同子項目一起搬,放在上面選的位置;換分組時整串項目一併改到新分組。"}
        </p>

        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-xs text-neutral-500 dark:text-neutral-400" title={where}>
            {verb}到:{where}
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || !groupId || !treeReady}
              onClick={() => onConfirm({ boardId: targetBoardId, groupId, parentId: parentId || null, position })}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? `${verb}中…` : verb}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
