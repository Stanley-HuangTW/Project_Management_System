"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { subtreeIdsOf } from "@/lib/bulkStructure";
import { computeWbsCodes } from "@/lib/wbs";
import type { BoardWithData } from "@/types/board";
import { ItemTreePicker } from "./ItemTreePicker";

export type BulkTarget = { groupId: string; parentId: string | null };

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
            onChange={setParentId}
            placeholder="(分組最上層)"
            disabled={busy}
            className="flex w-full items-center justify-between gap-1 rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-left text-sm outline-none focus:border-blue-500 disabled:opacity-50"
          />
        </div>

        <p className="rounded-md bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300">
          {mode === "copy"
            ? "複製會帶走欄位值(日期、狀態、負責人欄位等)與所有子項目,接在目標底下現有項目的最後面。前置依賴:指到這次一起複製的項目,會改指新的複本;指到範圍外的維持不變。不含指派人員、留言、附件與待辦。"
            : "移動會連同子項目一起搬,接在目標底下現有項目的最後面;換分組時整串項目一併改到新分組。"}
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
              onClick={() => onConfirm({ groupId, parentId: parentId || null })}
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
