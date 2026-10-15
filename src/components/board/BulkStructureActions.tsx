"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, FolderInput, Replace, Trash2, X } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { bulkCopyItems, bulkMoveItems, bulkReplaceItemNames } from "@/lib/actions/bulkStructure";
import { bulkCopyItemsAcross, bulkMoveItemsAcross } from "@/lib/actions/bulkCrossBoard";
import { deleteItem, previewItemDeletion, type DeletionDependent, type DeletionImpact } from "@/lib/actions/item";
import { collapseToRoots, subtreeIdsOf } from "@/lib/bulkStructure";
import type { BoardWithData } from "@/types/board";
import { BulkRenameDialog } from "./BulkRenameDialog";
import { BulkTargetDialog, type BulkTarget } from "./BulkTargetDialog";

const MAX_LISTED = 12;
const MAX_NAMED = 5;

/** 勾選的項目收斂成「根項目」(祖先也被勾的不另外算),以及連同子項目一共幾個。 */
export function useSelectionRoots(board: BoardWithData, selectedIds: Set<string>) {
  return useMemo(() => {
    const rootIds = collapseToRoots(board.items, selectedIds, board.groups.map((g) => g.id));
    return { rootIds, totalCount: subtreeIdsOf(board.items, rootIds).size };
  }, [board.items, board.groups, selectedIds]);
}

const buttonClass =
  "flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50";
const neutralButton = `${buttonClass} border-blue-300 dark:border-blue-700 bg-white dark:bg-neutral-900 text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900`;
const dangerButton = `${buttonClass} border-red-300 dark:border-red-800 bg-white dark:bg-neutral-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950`;

/**
 * 勾選之後的「複製 / 移動 / 取代名稱 / 刪除」。表格視圖(塞在批次編輯列裡)與甘特圖(自己的選取列)
 * 共用這一份。複製與移動可以放到別的看板(見 bulkCrossBoard.ts);刪除是移到垃圾桶,可以還原。
 */
export function BulkStructureActions({
  board,
  selectedIds,
  canCopyMove,
  canDelete,
  onDone,
}: {
  board: BoardWithData;
  selectedIds: Set<string>;
  /** 管理者、主管,或至少負責某個分組的人;真正的權限由 server 逐個分組再檢查一次。 */
  canCopyMove: boolean;
  canDelete: boolean;
  /** 動作成功之後清掉勾選。 */
  onDone: () => void;
}) {
  const router = useRouter();
  const { notify, confirm, choose } = useDialogs();
  const [dialog, setDialog] = useState<"copy" | "move" | "rename" | null>(null);
  const [busy, setBusy] = useState(false);
  const { rootIds, totalCount } = useSelectionRoots(board, selectedIds);

  async function runTarget(mode: "copy" | "move", target: BulkTarget) {
    setBusy(true);
    try {
      const crossBoard = target.boardId !== board.id;
      const result = crossBoard
        ? await (mode === "copy"
            ? bulkCopyItemsAcross(rootIds, target.parentId, target.groupId)
            : bulkMoveItemsAcross(rootIds, target.parentId, target.groupId))
        : {
            ...(mode === "copy"
              ? await bulkCopyItems(board.id, rootIds, target.parentId, target.groupId)
              : await bulkMoveItems(board.id, rootIds, target.parentId, target.groupId, target.position)),
            targetBoardName: "",
            notes: [] as string[],
          };
      const verb = mode === "copy" ? "複製" : "移動";
      if (result.error) {
        // 對話框不關,讓人改選別的目標再試。
        await notify(result.error, { title: `無法${verb}` });
        return;
      }
      router.refresh();
      setDialog(null);
      onDone();
      const group = board.groups.find((g) => g.id === target.groupId);
      const parent = target.parentId ? board.items.find((i) => i.id === target.parentId) : null;
      const where = crossBoard
        ? `看板「${result.targetBoardName}」`
        : `「${group?.name ?? ""}」${parent ? `的「${parent.name}」底下` : "的最上層"}`;
      const notes = result.notes.length > 0 ? `\n\n請留意:\n${result.notes.map((n) => `・${n}`).join("\n")}` : "";
      await notify(`已${verb} ${result.roots} 項(含子項目共 ${result.items} 項)到${where}。${notes}`, {
        title: `${verb}完成`,
      });
    } catch {
      await notify("操作失敗,請重新整理後再試一次。", { title: `無法${mode === "copy" ? "複製" : "移動"}` });
    } finally {
      setBusy(false);
    }
  }

  async function runRename(find: string, replace: string) {
    setBusy(true);
    try {
      const result = await bulkReplaceItemNames(board.id, [...selectedIds], find, replace);
      if (result.error) {
        await notify(result.error, { title: "無法取代名稱" });
        return;
      }
      router.refresh();
      setDialog(null);
      onDone();
      await notify(
        `已改了 ${result.changed} 個項目的名稱${result.unchanged > 0 ? `,${result.unchanged} 個沒有這段字樣` : ""}${
          result.blank > 0 ? `,${result.blank} 個取代後會變空白而略過` : ""
        }。`,
        { title: "取代完成" }
      );
    } catch {
      await notify("操作失敗,請重新整理後再試一次。", { title: "無法取代名稱" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (rootIds.length === 0) return;
    setBusy(true);
    try {
      const nameOf = (id: string) => board.items.find((i) => i.id === id)?.name ?? "";
      const named = rootIds.slice(0, MAX_NAMED).map((id) => `・${nameOf(id)}`);
      if (rootIds.length > MAX_NAMED) named.push(`・…另外還有 ${rootIds.length - MAX_NAMED} 項`);

      // 刪掉之後,靠這些項目當前置的「其他」工作項會被改寫——跟單筆刪除一樣先講清楚。
      // 一起被刪的不算(它們自己也要進垃圾桶)。
      const impacts = (await Promise.all(rootIds.map((id) => previewItemDeletion(id)))).filter(
        (impact): impact is DeletionImpact => impact !== null
      );
      const doomed = subtreeIdsOf(board.items, rootIds);
      const dependents = new Map<string, DeletionDependent>();
      for (const impact of impacts) {
        for (const d of impact.dependents) if (!doomed.has(d.itemId)) dependents.set(d.itemId, d);
      }

      const header = [
        `確定要刪除選取的 ${rootIds.length} 個項目(含子項目共 ${totalCount} 項)嗎?`,
        ...named,
        "",
        "刪除後可從看板「…」選單的垃圾桶還原。",
      ];

      let repoint = false;
      if (dependents.size === 0) {
        const ok = await confirm(header.join("\n"), { title: "刪除項目", confirmLabel: "刪除", danger: true });
        if (!ok) return;
      } else {
        const listed = [...dependents.values()].slice(0, MAX_LISTED).map(
          (d) => `・${d.wbsCode} ${d.name}${d.start ? `(${d.start}~${d.end})` : ""}`
        );
        if (dependents.size > listed.length) listed.push(`・…另外還有 ${dependents.size - listed.length} 項`);
        const message = [
          ...header,
          "",
          `另有 ${dependents.size} 個工作項以被刪除的項目為前置依賴:`,
          ...listed,
        ].join("\n");
        const canInherit = impacts.some((impact) => impact.inherit);
        if (canInherit) {
          const picked = await choose(`${message}\n\n要讓它們改為參照被刪項目自己的前置嗎?`, {
            title: "刪除項目",
            choices: [
              { key: "inherit", label: "改為參照被刪項目的前置並刪除" },
              { key: "detach", label: "不參照,清空它們的前置並刪除", danger: true },
            ],
          });
          if (!picked) return;
          repoint = picked === "inherit";
        } else {
          const ok = await confirm(`${message}\n\n刪除後它們會失去前置依賴,時間停在目前算出的值。`, {
            title: "刪除項目",
            confirmLabel: "清空它們的前置並刪除",
            danger: true,
          });
          if (!ok) return;
        }
      }

      // 一個一個刪:每個根項目是垃圾桶裡獨立的一筆,各自還原得回去。
      const failed: string[] = [];
      for (const id of rootIds) {
        try {
          await deleteItem(board.id, id, repoint);
        } catch {
          failed.push(`・${nameOf(id)}`);
        }
      }
      router.refresh();
      if (failed.length < rootIds.length) onDone();
      const deleted = rootIds.length - failed.length;
      await notify(
        failed.length === 0
          ? `已刪除 ${deleted} 個項目(含子項目共 ${totalCount} 項),可從垃圾桶還原。`
          : [
              `已刪除 ${deleted} 個項目,以下 ${failed.length} 個沒有刪成(可能沒有權限,刪除限管理者,或主管本人建立的項目):`,
              ...failed,
            ].join("\n"),
        { title: failed.length === 0 ? "刪除完成" : "部分項目沒有刪除" }
      );
    } catch {
      await notify("刪除失敗,請重新整理後再試一次。", { title: "無法刪除" });
    } finally {
      setBusy(false);
    }
  }

  if (rootIds.length === 0) return null;

  return (
    <>
      {canCopyMove && (
        <>
          <button type="button" disabled={busy} onClick={() => setDialog("copy")} className={neutralButton}>
            <Copy size={13} /> 複製到…
          </button>
          <button type="button" disabled={busy} onClick={() => setDialog("move")} className={neutralButton}>
            <FolderInput size={13} /> 移動到…
          </button>
          <button type="button" disabled={busy} onClick={() => setDialog("rename")} className={neutralButton}>
            <Replace size={13} /> 取代名稱…
          </button>
        </>
      )}
      {canDelete && (
        <button type="button" disabled={busy} onClick={handleDelete} className={dangerButton}>
          <Trash2 size={13} /> 刪除
        </button>
      )}
      {dialog === "rename" && (
        <BulkRenameDialog
          items={board.items.filter((i) => selectedIds.has(i.id))}
          busy={busy}
          onConfirm={runRename}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog === "copy" || dialog === "move") && (
        <BulkTargetDialog
          mode={dialog}
          board={board}
          rootIds={rootIds}
          totalCount={totalCount}
          busy={busy}
          onConfirm={(target) => runTarget(dialog, target)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

/** 甘特圖用的選取列(表格視圖沿用批次編輯列,把上面的按鈕塞進去)。 */
export function BulkStructureBar({
  board,
  selectedIds,
  canCopyMove,
  canDelete,
  onClear,
}: {
  board: BoardWithData;
  selectedIds: Set<string>;
  canCopyMove: boolean;
  canDelete: boolean;
  onClear: () => void;
}) {
  const { rootIds, totalCount } = useSelectionRoots(board, selectedIds);
  if (rootIds.length === 0) return null;
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-3 py-2 text-xs">
      <span className="font-medium text-blue-800 dark:text-blue-200">
        已選 {rootIds.length} 項{totalCount > rootIds.length ? `(含子項目共 ${totalCount} 項)` : ""}
      </span>
      <BulkStructureActions
        board={board}
        selectedIds={selectedIds}
        canCopyMove={canCopyMove}
        canDelete={canDelete}
        onDone={onClear}
      />
      <button
        type="button"
        onClick={onClear}
        className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900"
      >
        <X size={13} /> 取消選取
      </button>
    </div>
  );
}
