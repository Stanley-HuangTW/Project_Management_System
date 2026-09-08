"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { captureBaseline, clearBaseline } from "@/lib/actions/baseline";
import { useDialogs } from "@/components/ui/DialogProvider";

export type BaselineBoard = {
  id: string;
  name: string;
  baselineCapturedAt: Date | null;
};

function formatCapturedAt(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
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
        把目前每個項目的開始/結束/天數存成「原始計畫」。之後日期再怎麼改,甘特圖會在每根長條下方畫出當初的計畫,項目卡片也會顯示延遲或提前幾天。<b>重新建立會覆蓋舊的基準線</b>,通常只在正式重新排程後才做。
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
  const { confirm, notify } = useDialogs();
  const [busy, setBusy] = useState(false);

  async function handleCapture() {
    const ok = await confirm(
      board.baselineCapturedAt
        ? `「${board.name}」已有 ${formatCapturedAt(board.baselineCapturedAt)} 建立的基準線,重新建立會覆蓋它,舊的計畫就找不回來了。確定要用目前的日期重新建立嗎?`
        : `將「${board.name}」目前所有項目的開始/結束/天數存成基準線,之後就能看出每個項目延遲或提前多少。`,
      { title: board.baselineCapturedAt ? "重新建立基準線" : "建立基準線", confirmLabel: "建立" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const captured = await captureBaseline(board.id);
      router.refresh();
      await notify(`已為「${board.name}」的 ${captured} 個項目建立基準線。`, { title: "基準線已建立" });
    } catch (err) {
      await notify(err instanceof Error ? err.message : "建立失敗", { title: "無法建立基準線" });
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
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-100 dark:border-neutral-700 px-3 py-2">
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
  );
}
