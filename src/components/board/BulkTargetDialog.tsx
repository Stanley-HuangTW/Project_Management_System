"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { planMoveToParent, subtreeIdsOf, type MovePosition } from "@/lib/bulkStructure";
import { computeWbsCodes } from "@/lib/wbs";
import type { BoardWithData } from "@/types/board";
import { ItemTreePicker } from "./ItemTreePicker";

/** position 只有「移動」會用到:複製一律接在目標底下現有項目的最後面。 */
export type BulkTarget = { groupId: string; parentId: string | null; position?: MovePosition };

const POSITION_END = "__end__";
const POSITION_START = "__start__";

/**
 * 複製 / 移動要放到哪裡:同一個看板內任何分組裡的任何項目底下,或某個分組的最上層。
 * 被勾選的項目(連同它們的子項目)不能當目標——放進自己底下沒有意義。
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
  const [groupId, setGroupId] = useState(first?.groupId ?? board.groups[0]?.id ?? "");
  const [parentId, setParentId] = useState(first?.parentId ?? "");

  const excluded = useMemo(() => subtreeIdsOf(board.items, rootIds), [board.items, rootIds]);
  const groupItems = useMemo(() => board.items.filter((i) => i.groupId === groupId), [board.items, groupId]);
  // 編號要照整個分組算,才跟畫面上看到的一致;可選的清單則扣掉被選的子樹。
  const wbsByItemId = useMemo(() => computeWbsCodes(groupItems), [groupItems]);
  const pickable = useMemo(() => groupItems.filter((i) => !excluded.has(i.id)), [groupItems, excluded]);

  // 移動時可以決定插在新父層的哪個位置(也就是 WBS 編號的順序)。選項是新父層底下現有的
  // 項目(扣掉被搬的):「接在它後面」;再加上最前面、最後面。
  const [positionValue, setPositionValue] = useState(POSITION_END);
  const siblings = useMemo(
    () =>
      groupItems
        .filter((i) => i.parentId === (parentId || null) && !excluded.has(i.id))
        .sort((a, b) => a.order - b.order),
    [groupItems, parentId, excluded]
  );
  const position: MovePosition | undefined =
    mode !== "move" || positionValue === POSITION_END
      ? undefined
      : { afterId: positionValue === POSITION_START ? null : positionValue };

  // 套用之後被搬項目的新 WBS 編號——跟實際搬完看到的是同一套算法。
  const resultingCodes = useMemo(() => {
    if (mode !== "move") return null;
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
  }, [mode, board.items, rootIds, parentId, groupId, positionValue]);

  const group = board.groups.find((g) => g.id === groupId);
  const parent = parentId ? board.items.find((i) => i.id === parentId) : undefined;
  const verb = mode === "copy" ? "複製" : "移動";
  const where = `${group?.name ?? ""} › ${parent ? `${wbsByItemId.get(parent.id) ?? ""} ${parent.name}`.trim() : "最上層"}`;

  return (
    <Modal open onOpenChange={(open) => !open && !busy && onClose()} title={`${verb}到…`}>
      <div className="space-y-4 text-sm text-neutral-700 dark:text-neutral-200">
        <p>
          已選 {rootIds.length} 項(含子項目共 {totalCount} 項)。
        </p>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">分組</span>
          <select
            value={groupId}
            disabled={busy}
            onChange={(e) => {
              setGroupId(e.target.value);
              setParentId("");
              setPositionValue(POSITION_END);
            }}
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
          >
            {board.groups.map((g) => (
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
            placeholder="(分組最上層)"
            disabled={busy}
            className="flex w-full items-center justify-between gap-1 rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-left text-sm outline-none focus:border-blue-500 disabled:opacity-50"
          />
        </div>

        {mode === "move" && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
              位置(決定 WBS 編號的順序)
            </span>
            <select
              value={positionValue}
              disabled={busy}
              onChange={(e) => setPositionValue(e.target.value)}
              className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
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
          {mode === "copy"
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
              disabled={busy || !groupId}
              onClick={() => onConfirm({ groupId, parentId: parentId || null, position })}
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
