"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, FolderInput, Pencil, Trash2, X } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { actionErrorMessage } from "@/lib/userError";
import type { BomLineRow } from "@/lib/actions/bom";
import {
  bulkCopyBomLines,
  bulkDeleteBomLines,
  bulkEditBomLines,
  bulkMoveBomLines,
  bulkShiftBomLevels,
  type BulkEditField,
  type BulkPlaceTarget,
} from "@/lib/actions/bomBulk";
import { selectionRoots } from "@/lib/bomBulk";
import type { BomColumnDef } from "@/lib/bomColumns";
import { BomBulkEditDialog } from "./BomBulkEditDialog";
import { BomBulkMoveDialog } from "./BomBulkMoveDialog";

const button =
  "flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:bg-neutral-900 dark:text-blue-200 dark:hover:bg-blue-900";
const danger =
  "flex items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-neutral-900 dark:text-red-400 dark:hover:bg-red-950";

/**
 * BOM 勾選之後出現的操作列:升階 / 降階、編輯某個欄位、移動或複製到別處、刪除。
 * 跟看板表格勾選之後的操作列同一個用法:勾一列,它底下的子項目一起處理;父項與子項都勾只算父項;
 * 「編輯」只改打勾的列本身。
 */
export function BomBulkBar({
  boardId,
  product,
  phaseId,
  lines,
  columns,
  users,
  products,
  phases,
  selectedIds,
  onClear,
  onChanged,
}: {
  boardId: string;
  product: string;
  phaseId: string;
  /** 這一份 BOM 畫面上的順序(含收起來的列)。 */
  lines: BomLineRow[];
  columns: BomColumnDef[];
  users: { id: string; name: string }[];
  products: string[];
  phases: { id: string; name: string }[];
  selectedIds: Set<string>;
  onClear: () => void;
  /** 動作成功之後:重讀這份 BOM 與候選清單,整張表的列重新掛上去。 */
  onChanged: () => Promise<void>;
}) {
  const { notify, confirm } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"edit" | "move" | null>(null);
  const ids = [...selectedIds];
  const { rootIds, subtreeIds } = selectionRoots(lines, selectedIds);
  const from = { product, phaseId };

  /** 跑一個動作:失敗把原因說明、成功重讀;有提醒(單價不再算…)再說明一次。回傳 true = 成功。 */
  async function exec(work: () => Promise<{ error?: string; notice?: string }>, failTitle: string): Promise<boolean> {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return false;
      }
      await onChanged();
      if (result.notice) await notify(result.notice, { title: "調整後的提醒" });
      return true;
    } catch (err) {
      await notify(actionErrorMessage(err, "操作失敗"), { title: failTitle });
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** 對話框用的:失敗回說明文字(留在對話框裡),成功回 null(對話框關掉),結果說明稍後再跳。 */
  async function inDialog<R extends { error?: string; notice?: string }>(work: () => Promise<R>, describe: (result: R) => string | null): Promise<string | null> {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) return result.error;
      await onChanged();
      onClear();
      const message = [describe(result), result.notice].filter(Boolean).join("\n\n");
      if (message) setTimeout(() => void notify(message, { title: "完成" }), 250);
      return null;
    } catch (err) {
      return actionErrorMessage(err, "操作失敗");
    } finally {
      setBusy(false);
    }
  }

  async function shift(delta: 1 | -1) {
    await exec(() => bulkShiftBomLevels(boardId, product, phaseId, ids, delta), delta > 0 ? "無法降階" : "無法升階");
  }

  async function remove() {
    const names = lines.filter((l) => selectedIds.has(l.id)).map((l) => `「${l.name}」`);
    const shown = names.slice(0, 8).join("、") + (names.length > 8 ? `…等 ${names.length} 列` : "");
    const ok = await confirm(
      `刪除選取的 ${ids.length} 列${subtreeIds.size !== ids.length ? `(連同子項目共 ${subtreeIds.size} 列)` : ""}?\n${shown}\n\n它們的檔案附件也會一併刪除,無法復原。`,
      { title: "批次刪除", confirmLabel: "刪除", danger: true }
    );
    if (!ok) return;
    if (await exec(() => bulkDeleteBomLines(boardId, product, phaseId, ids), "無法刪除")) onClear();
  }

  return (
    <>
      <div
        data-bom-bulk-bar
        className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-800 dark:bg-blue-950"
      >
        <span className="font-medium text-blue-800 dark:text-blue-200">
          已選 {ids.length} 列{subtreeIds.size !== ids.length && `(連同子項目共 ${subtreeIds.size} 列)`}
        </span>
        <button type="button" data-bom-bulk-outdent disabled={busy} onClick={() => void shift(-1)} className={button} title="升階:勾選的列(連同子項目)往外一層">
          <ChevronLeft size={13} /> 升階
        </button>
        <button type="button" data-bom-bulk-indent disabled={busy} onClick={() => void shift(1)} className={button} title="降階:勾選的列(連同子項目)變成前一列的子項目">
          降階 <ChevronRight size={13} />
        </button>
        <button type="button" data-bom-bulk-edit-button disabled={busy} onClick={() => setDialog("edit")} className={button} title="把勾選的列的某個欄位一次改成同一個值">
          <Pencil size={13} /> 編輯…
        </button>
        <button type="button" data-bom-bulk-move-button disabled={busy} onClick={() => setDialog("move")} className={button} title="移到(或複製到)同一份或別份 BOM 的指定位置">
          <FolderInput size={13} /> 移動或複製到…
        </button>
        <button type="button" data-bom-bulk-delete disabled={busy} onClick={() => void remove()} className={danger}>
          <Trash2 size={13} /> 刪除
        </button>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900"
        >
          <X size={13} /> 取消選取
        </button>
      </div>

      <BomBulkEditDialog
        open={dialog === "edit"}
        onOpenChange={(open) => !open && setDialog(null)}
        count={ids.length}
        columns={columns}
        users={users}
        onApply={(field: BulkEditField) =>
          inDialog(
            () => bulkEditBomLines(boardId, product, phaseId, ids, field),
            (r) => `已修改 ${r.changed ?? 0} 列。${(r.skipped ?? []).length > 0 ? `\n${(r.skipped ?? []).join("\n")}` : ""}`
          )
        }
      />
      <BomBulkMoveDialog
        open={dialog === "move"}
        onOpenChange={(open) => !open && setDialog(null)}
        boardId={boardId}
        from={from}
        products={products}
        phases={phases}
        rootIds={rootIds}
        subtreeIds={subtreeIds}
        selectedCount={ids.length}
        onApply={(mode, target: BulkPlaceTarget) =>
          inDialog(
            () => (mode === "move" ? bulkMoveBomLines(boardId, from, ids, target) : bulkCopyBomLines(boardId, from, ids, target)),
            (r) => (mode === "move" ? `已移動 ${"moved" in r ? (r.moved ?? 0) : 0} 列(連同子項目共 ${subtreeIds.size} 列)。` : `已複製 ${"copied" in r ? (r.copied ?? 0) : 0} 列。`)
          )
        }
      />
    </>
  );
}
