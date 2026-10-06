"use client";

import { useEffect, useState } from "react";
import { Tags } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  createTimeCategory,
  listTimeCategories,
  renameTimeCategory,
  setTimeCategoryActive,
  setTimeCategoryLinkIssue,
  setTimeCategoryAllowProject,
  type TimeCategoryRow,
} from "@/lib/actions/timeCategory";

const inputClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500";

/**
 * 非專案工時的類別。停用而不刪除:舊的工時紀錄還引用著它,刪掉就沒有名字可以
 * 顯示了。「可連結議題」勾起來的類別,登記工時時會多一個選風險登記冊議題的欄位。
 */
export function TimeCategoryCard() {
  const { notify } = useDialogs();
  const [categories, setCategories] = useState<TimeCategoryRow[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [newName, setNewName] = useState("");
  const [newLinkIssue, setNewLinkIssue] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listTimeCategories();
      if (!cancelled) setCategories(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function run(work: () => Promise<{ error?: string }>, failTitle: string): Promise<boolean> {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return false;
      }
      setRefreshKey((k) => k + 1);
      return true;
    } catch (err) {
      await notify(err instanceof Error ? err.message : "操作失敗", { title: failTitle });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!newName.trim()) return;
    const ok = await run(() => createTimeCategory(newName, newLinkIssue), "無法新增類別");
    if (ok) {
      setNewName("");
      setNewLinkIssue(false);
    }
  }

  return (
    <div className="max-w-2xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        <Tags size={15} /> 工時類別
      </p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        「工時」頁面登記會議、請假、出差等工時(不是某個工作項的工時)時選的類別。停用的類別不能再用來登記,
        舊紀錄照常顯示。勾「可連結議題」的類別,登記時可以選一筆風險登記冊裡的議題;勾「可對應專案」的類別,
        登記時可以選對應的專案(要主管核准才計入那個專案的成本)。
      </p>

      {categories === null ? (
        <p className="py-2 text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : (
        <ul className="mb-3 divide-y divide-neutral-100 rounded-md border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
          {categories.map((c) => (
            <CategoryRow key={`${c.id}:${c.name}`} category={c} busy={busy} run={run} />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="新增類別名稱"
          maxLength={30}
          className={`${inputClass} min-w-[10rem] flex-1`}
        />
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" checked={newLinkIssue} onChange={(e) => setNewLinkIssue(e.target.checked)} />
          可連結議題
        </label>
        <button
          type="button"
          disabled={busy || !newName.trim()}
          onClick={add}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          新增
        </button>
      </div>
    </div>
  );
}

function CategoryRow({
  category,
  busy,
  run,
}: {
  category: TimeCategoryRow;
  busy: boolean;
  run: (work: () => Promise<{ error?: string }>, failTitle: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(category.name);

  async function saveName() {
    const next = name.trim();
    if (!next || next === category.name) {
      setName(category.name);
      return;
    }
    const ok = await run(() => renameTimeCategory(category.id, next), "無法改名");
    if (!ok) setName(category.name);
  }

  return (
    <li className={`flex flex-wrap items-center gap-3 px-3 py-2 ${category.active ? "" : "opacity-60"}`}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        maxLength={30}
        disabled={busy}
        className={`${inputClass} min-w-[8rem] flex-1`}
      />
      <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
        <input
          type="checkbox"
          checked={category.linkIssue}
          disabled={busy}
          onChange={(e) => run(() => setTimeCategoryLinkIssue(category.id, e.target.checked), "無法儲存")}
        />
        可連結議題
      </label>
      <label
        className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300"
        title="勾起來:登記時可以選對應的專案(要主管核准才計入那個專案的成本)。不屬於專案的類別(部門週會、請假…)不要勾。"
      >
        <input
          type="checkbox"
          checked={category.allowProject}
          disabled={busy}
          onChange={(e) => run(() => setTimeCategoryAllowProject(category.id, e.target.checked), "無法儲存")}
        />
        可對應專案
      </label>
      <span className="w-16 text-right text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
        {category.entryCount} 筆
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => setTimeCategoryActive(category.id, !category.active), "無法儲存")}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {category.active ? "停用" : "啟用"}
      </button>
    </li>
  );
}
