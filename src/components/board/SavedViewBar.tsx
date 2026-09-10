"use client";

import { useEffect, useState } from "react";
import { Bookmark, Check, Trash2, X } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isEmptyViewConfig, type ViewConfig } from "@/lib/savedView";
import {
  listSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  type SavedViewSummary,
} from "@/lib/actions/savedView";

/**
 * 儲存的檢視: the filter set you keep re-entering, kept.
 *
 * Sits next to the filter bar in both the table and the Gantt — the current
 * filters are the view, so saving one is a button, not a form to fill in
 * twice.
 */
export function SavedViewBar({
  boardId,
  currentConfig,
  onApply,
}: {
  boardId: string;
  currentConfig: ViewConfig;
  onApply: (config: ViewConfig) => void;
}) {
  const { notify, confirm } = useDialogs();
  const [views, setViews] = useState<SavedViewSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await listSavedViews(boardId);
      if (!cancelled) setViews(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const active = views.find((v) => v.id === activeId) ?? null;

  async function reload() {
    setViews(await listSavedViews(boardId));
  }

  function apply(id: string) {
    setActiveId(id);
    const view = views.find((v) => v.id === id);
    onApply(view ? view.config : { filters: [], groupFilterId: "", searchQuery: "" });
  }

  async function handleSave() {
    setBusy(true);
    try {
      const result = await createSavedView(boardId, name, currentConfig, shared);
      if (result.error) {
        await notify(result.error, { title: "無法儲存檢視" });
        return;
      }
      await reload();
      if (result.id) setActiveId(result.id);
      setNaming(false);
      setName("");
      setShared(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate() {
    if (!active) return;
    setBusy(true);
    try {
      const result = await updateSavedView(active.id, currentConfig);
      if (result.error) {
        await notify(result.error, { title: "無法更新檢視" });
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!active) return;
    const ok = await confirm(`刪除檢視「${active.name}」?`, {
      title: "刪除檢視",
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await deleteSavedView(active.id);
      if (result.error) {
        await notify(result.error, { title: "無法刪除檢視" });
        return;
      }
      setActiveId("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const buttonClass =
    "rounded border border-neutral-200 dark:border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50";

  return (
    <div className="flex items-center gap-1.5">
      <Bookmark size={13} className="text-neutral-400 dark:text-neutral-500" />
      <select
        value={activeId}
        onChange={(e) => apply(e.target.value)}
        className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-0.5 text-xs outline-none focus:border-blue-500"
      >
        <option value="">儲存的檢視...</option>
        {views.map((view) => (
          <option key={view.id} value={view.id}>
            {view.name}
            {view.isOwn ? (view.isShared ? "(共用中)" : "") : `(${view.ownerName} 共用)`}
          </option>
        ))}
      </select>

      {active?.isOwn && (
        <>
          <button type="button" disabled={busy} onClick={handleUpdate} className={buttonClass}>
            更新為目前條件
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleDelete}
            className="rounded px-1 py-0.5 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
            aria-label="刪除檢視"
          >
            <Trash2 size={13} />
          </button>
        </>
      )}

      {naming ? (
        <div className="flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setNaming(false);
            }}
            placeholder="檢視名稱,例如 我的逾期任務"
            className="w-40 rounded border-none bg-transparent text-xs outline-none"
          />
          <label className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            共用給看板成員
          </label>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={handleSave}
            className="text-blue-600 disabled:opacity-40"
            aria-label="儲存檢視"
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            onClick={() => setNaming(false)}
            className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
            aria-label="取消"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          // Saving "no filters at all" would make a view that does nothing.
          disabled={isEmptyViewConfig(currentConfig)}
          title={isEmptyViewConfig(currentConfig) ? "先設好篩選條件再儲存" : undefined}
          onClick={() => setNaming(true)}
          className={buttonClass}
        >
          儲存目前條件
        </button>
      )}
    </div>
  );
}
