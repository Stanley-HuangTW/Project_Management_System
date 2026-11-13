"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import {
  captureBaseline,
  clearBaseline,
  listBaselines,
  activateBaseline,
  renameBaseline,
  deleteBaseline,
  type BaselineVersion,
} from "@/lib/actions/baseline";
import { useDialogs } from "@/components/ui/DialogProvider";
import { actionErrorMessage } from "@/lib/userError";
import { withWeekday } from "@/lib/weekdayLabel";

export type BaselineBoard = {
  id: string;
  name: string;
  baselineCapturedAt: Date | null;
};

function formatCapturedAt(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${withWeekday(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`)} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/**
 * Capturing a baseline freezes every item's current Start/Finish/Days as the
 * plan the board is measured against. Everything downstream — the Gantt's
 * baseline bar, the item card's 延遲 N 天 — reads from that snapshot, so
 * re-capturing is a re-plan, not a refresh, and both actions confirm.
 */
export function BaselineCard({ boards }: { boards: BaselineBoard[] }) {
  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">基準線(Baseline)</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        把目前每個項目的開始/結束/天數存成「原始計畫」。之後日期再怎麼改,甘特圖會在每根長條下方畫出當初的計畫,項目卡片也會顯示延遲或提前幾天。<b>重新建立不會刪掉舊的</b>——每一版都留著,隨時可以切回去比對。
      </p>
      <div className="space-y-2">
        {boards.map((board) => (
          <BaselineRow key={board.id} board={board} />
        ))}
        {boards.length === 0 && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">目前沒有看板。</p>
        )}
      </div>
    </div>
  );
}

function BaselineRow({ board }: { board: BaselineBoard }) {
  const router = useRouter();
  const { confirm, notify, prompt } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  /** Null until the history is first opened — a settings page with ten
   *  boards should not query ten baselines nobody asked to see. */
  const [versions, setVersions] = useState<BaselineVersion[] | null>(null);

  async function handleCapture() {
    const ok = await confirm(
      board.baselineCapturedAt
        ? `用目前的日期為「${board.name}」建立新的一版基準線?${formatCapturedAt(board.baselineCapturedAt)} 那一版會保留下來,之後可以隨時切回去。`
        : `將「${board.name}」目前所有項目的開始/結束/天數存成基準線,之後就能看出每個項目延遲或提前多少。`,
      { title: board.baselineCapturedAt ? "建立新版基準線" : "建立基準線", confirmLabel: "建立" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const captured = await captureBaseline(board.id);
      await loadVersions();
      router.refresh();
      await notify(`已為「${board.name}」的 ${captured} 個項目建立基準線。`, { title: "基準線已建立" });
    } catch (err) {
      await notify(actionErrorMessage(err, "建立失敗"), { title: "無法建立基準線" });
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    const ok = await confirm(`確定要清除「${board.name}」的基準線嗎?所有計畫 vs 實際的比較都會消失。`, {
      title: "清除基準線",
      confirmLabel: "清除",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await clearBaseline(board.id);
      await loadVersions();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function loadVersions() {
    setVersions(await listBaselines(board.id));
  }

  async function toggleHistory() {
    const next = !open;
    setOpen(next);
    if (next && versions === null) await loadVersions();
  }

  async function handleActivate(version: BaselineVersion) {
    const ok = await confirm(
      `把「${version.name}」設為目前的基準線?甘特圖的計畫線、項目卡片的延遲天數、報表的 PV 都會改用這一版。`,
      { title: "切換基準線", confirmLabel: "套用" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const result = await activateBaseline(version.id);
      if (result.error) {
        await notify(result.error, { title: "無法套用" });
        return;
      }
      await loadVersions();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(version: BaselineVersion) {
    const name = await prompt("這一版基準線要叫什麼名字?", {
      title: "重新命名基準線",
      defaultValue: version.name,
      required: true,
    });
    if (name === null) return;
    setBusy(true);
    try {
      const result = await renameBaseline(version.id, name);
      if (result.error) {
        await notify(result.error, { title: "無法重新命名" });
        return;
      }
      await loadVersions();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteVersion(version: BaselineVersion) {
    const ok = await confirm(`刪除基準線「${version.name}」?這一版的計畫就找不回來了。`, {
      title: "刪除基準線版本",
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await deleteBaseline(version.id);
      if (result.error) {
        await notify(result.error, { title: "無法刪除" });
        return;
      }
      await loadVersions();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-neutral-100 dark:border-neutral-700 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={toggleHistory}
        title="歷史版本"
        className="shrink-0 rounded p-0.5 text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      <span className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-100">
        {board.name}
      </span>
      <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
        {board.baselineCapturedAt
          ? `建立於 ${formatCapturedAt(board.baselineCapturedAt)}`
          : "尚未建立"}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={handleCapture}
        className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {board.baselineCapturedAt ? "重新建立" : "建立基準線"}
      </button>
      {board.baselineCapturedAt && (
        <button
          type="button"
          disabled={busy}
          onClick={handleClear}
          className="shrink-0 rounded-md border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
        >
          清除
        </button>
      )}
      </div>

      {open && (
        <div className="mt-2 border-t border-neutral-100 dark:border-neutral-700 pt-2">
          {versions === null ? (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">載入中...</p>
          ) : versions.length === 0 ? (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">還沒有任何版本。</p>
          ) : (
            <ul className="space-y-1">
              {versions.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => handleRename(version)}
                    title="重新命名"
                    className="min-w-0 flex-1 truncate text-left text-neutral-700 dark:text-neutral-100 hover:text-blue-600"
                  >
                    {version.name}
                    {version.isActive && (
                      <span className="ml-1.5 rounded bg-blue-100 dark:bg-blue-950 px-1 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                        套用中
                      </span>
                    )}
                  </button>
                  <span className="shrink-0 text-neutral-400 dark:text-neutral-500">
                    {version.itemCount} 項{version.capturedBy ? `・${version.capturedBy}` : ""}
                  </span>
                  {!version.isActive && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleActivate(version)}
                      className="shrink-0 rounded border border-neutral-200 dark:border-neutral-600 px-1.5 py-0.5 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
                    >
                      套用
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || version.isActive}
                    onClick={() => handleDeleteVersion(version)}
                    className="shrink-0 rounded p-0.5 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-30"
                    aria-label="刪除此版本"
                    title={version.isActive ? "套用中的版本不能刪除" : "刪除此版本"}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
