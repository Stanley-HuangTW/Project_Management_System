"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Pencil, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  createProgram,
  renameProgram,
  deleteProgram,
  setBoardProgram,
  type ProgramRow,
} from "@/lib/actions/program";

export type ProgramBoard = { id: string; name: string; programId: string | null };

/**
 * 專案群組 — the boards that belong to one project.
 *
 * A Pred normally only reaches items on its own board, so POC/EVT/PVT split
 * across three boards can't wait on each other. Putting them in one group
 * makes them a single schedule: a Pred can point at any item in the group, the
 * cascade follows it across, and 要徑 is computed over all of them together.
 * A board in no group behaves exactly as before.
 */
export function ProgramCard({
  programs,
  boards,
}: {
  programs: ProgramRow[];
  boards: ProgramBoard[];
}) {
  const router = useRouter();
  const { notify, confirm } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  const unassigned = boards.filter((b) => !b.programId);

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return false;
      }
      router.refresh();
      return true;
    } catch (err) {
      await notify(err instanceof Error ? err.message : "操作失敗", { title: failTitle });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (await run(() => createProgram(newName), "無法建立群組")) setNewName("");
  }

  async function handleRename(program: ProgramRow) {
    const name = window.prompt("群組名稱", program.name);
    if (name === null) return;
    await run(() => renameProgram(program.id, name), "無法重新命名");
  }

  async function handleDelete(program: ProgramRow) {
    const ok = await confirm(
      `刪除群組「${program.name}」?裡面的 ${program.boards.length} 個看板不會被刪除,只是各自回到獨立排程——跨看板的前置依賴會停止連動,已經算好的日期會留著。`,
      { title: "刪除專案群組", confirmLabel: "刪除", danger: true }
    );
    if (!ok) return;
    await run(() => deleteProgram(program.id), "無法刪除群組");
  }

  async function handleAdd(programId: string, boardId: string) {
    if (!boardId) return;
    const board = boards.find((b) => b.id === boardId);
    const ok = await confirm(
      `把「${board?.name}」加入這個群組?加入後會立刻重算整個群組的排程,原本指向其他看板、算不出來的前置依賴會開始生效,日期可能因此變動。`,
      { title: "加入專案群組", confirmLabel: "加入並重算" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const result = await setBoardProgram(boardId, programId);
      router.refresh();
      await notify(`已加入,重算了 ${result.recomputed} 個項目。`, { title: "已加入群組" });
    } catch (err) {
      await notify(err instanceof Error ? err.message : "操作失敗", { title: "無法加入群組" });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(board: { id: string; name: string }) {
    const ok = await confirm(
      `把「${board.name}」移出群組?它會回到獨立排程,跨看板的前置依賴會停止連動。`,
      { title: "移出專案群組", confirmLabel: "移出" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await setBoardProgram(board.id, null);
      router.refresh();
    } catch (err) {
      await notify(err instanceof Error ? err.message : "操作失敗", { title: "無法移出群組" });
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">專案群組</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        同一個專案拆成幾個看板(例如 POC / EVT / PVT)時,把它們放進一個群組,前置依賴就可以跨看板
        ——上一階段的驗證一延,下一階段的開工日跟著移,要徑也會貫穿整個群組一起算。
        沒有加入群組的看板行為完全不變。
      </p>

      <div className="space-y-3">
        {programs.map((program) => {
          const addable = unassigned;
          return (
            <div
              key={program.id}
              className="rounded-md border border-neutral-200 dark:border-neutral-700 p-3"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                  {program.name}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleRename(program)}
                  className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-blue-600 disabled:opacity-50"
                  aria-label="重新命名群組"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDelete(program)}
                  className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
                  aria-label="刪除群組"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {program.boards.length === 0 ? (
                <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                  還沒有看板。要跨看板連動,至少要放兩個。
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {program.boards.map((board) => (
                    <li key={board.id} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200">
                        {board.name}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRemove(board)}
                        className="shrink-0 rounded p-0.5 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
                        aria-label={`把 ${board.name} 移出群組`}
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {addable.length > 0 && (
                <select
                  value=""
                  disabled={busy}
                  onChange={(e) => handleAdd(program.id, e.target.value)}
                  className={`${fieldClass} mt-2 w-full text-xs`}
                >
                  <option value="">加入看板…</option>
                  {addable.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}

        {programs.length === 0 && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">目前沒有專案群組。</p>
        )}

        <div className="flex items-center gap-2">
          <input
            value={newName}
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新群組名稱"
            className={`${fieldClass} min-w-0 flex-1`}
          />
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={handleCreate}
            className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={14} /> 建立
          </button>
        </div>
      </div>
    </div>
  );
}
