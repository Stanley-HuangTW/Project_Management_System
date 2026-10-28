"use client";

import { useEffect, useState } from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import {
  addItemLink,
  deleteItemLink,
  getMantisInfoForLinks,
  listItemLinks,
  setItemLinkInWeeklyReport,
  type LinkMantisInfo,
} from "@/lib/actions/itemLink";
import { useDialogs } from "@/components/ui/DialogProvider";
import { canManageStructure } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";

export function LinksTab({
  boardId,
  itemId,
  currentUserId,
  userRole,
}: {
  boardId: string;
  itemId: string;
  /** 週報勾選:只有加這個連結的人、主管與管理者可以改。 */
  currentUserId: string;
  userRole: UserRole;
}) {
  const { notify } = useDialogs();
  // 這個連結要不要彙整進週報——預設要;新增之後下一個又回到預設。
  const [inWeekly, setInWeekly] = useState(true);
  const [links, setLinks] = useState<Awaited<ReturnType<typeof listItemLinks>>>([]);
  const [mantis, setMantis] = useState<Record<string, LinkMantisInfo>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  async function refresh() {
    const [list, info] = await Promise.all([listItemLinks(itemId), getMantisInfoForLinks(itemId)]);
    setLinks(list);
    setMantis(info);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [result, info] = await Promise.all([listItemLinks(itemId), getMantisInfoForLinks(itemId)]);
        if (!cancelled) {
          setLinks(result);
          setMantis(info);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await addItemLink(boardId, itemId, url, label, inWeekly);
      setUrl("");
      setLabel("");
      setInWeekly(true);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增失敗");
    } finally {
      setSaving(false);
    }
  }

  async function toggleWeekly(linkId: string, value: boolean) {
    setLinks((prev) => prev.map((l) => (l.id === linkId ? { ...l, inWeeklyReport: value } : l)));
    const result = await setItemLinkInWeeklyReport(itemId, linkId, value);
    if (result.error) {
      await refresh();
      await notify(result.error, { title: "無法更改" });
    }
  }

  async function handleDelete(linkId: string) {
    await deleteItemLink(boardId, itemId, linkId);
    await refresh();
  }

  return (
    <div>
      <form onSubmit={handleAdd} className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
          className="min-w-0 flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="顯示名稱(選填)"
          className="w-40 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        />
        <label
          className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300"
          title="勾選:這個連結會彙整進週報(預設勾選)"
        >
          <input
            type="checkbox"
            checked={inWeekly}
            onChange={(e) => setInWeekly(e.target.checked)}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          更新至週報
        </label>
        <button
          type="submit"
          disabled={saving || !url.trim()}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus size={14} /> 新增
        </button>
      </form>
      {error && (
        <div className="mb-3 rounded-md bg-red-50 dark:bg-red-950 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>}
      {!loading && links.length === 0 && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">尚無連結</p>
      )}
      <ul className="space-y-2">
        {links.map((l) => (
          <li
            key={l.id}
            className="flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 px-3 py-2"
          >
            <Link2 size={16} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              title={l.url}
              className="min-w-0 flex-1 truncate text-sm text-blue-600 hover:underline"
            >
              {l.label || l.url}
            </a>
            {mantis[l.id] && (
              <span
                className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                title={
                  mantis[l.id].synced
                    ? "這是同步下來的 Mantis 議題,狀態約每 15 分鐘更新一次"
                    : "這個問題還沒同步下來(不在連線的 Mantis 專案裡,或還沒同步到)"
                }
              >
                Mantis #{mantis[l.id].mantisId}
                {mantis[l.id].synced
                  ? "・" + (mantis[l.id].status ?? "—") + (mantis[l.id].handler ? "・" + mantis[l.id].handler : "")
                  : "・尚未同步"}
              </span>
            )}
            <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{l.createdBy.name}</span>
            <label
                className={`flex shrink-0 items-center gap-1 text-[11px] ${!(l.createdBy.id === currentUserId || canManageStructure(userRole)) ? "text-neutral-300 dark:text-neutral-600" : "cursor-pointer text-neutral-500 dark:text-neutral-400"}`}
                title={!(l.createdBy.id === currentUserId || canManageStructure(userRole)) ? "只有寫這一筆的人、主管與管理者可以改" : "勾選:這一筆的資訊會彙整進週報"}
              >
                <input type="checkbox" checked={l.inWeeklyReport} disabled={!(l.createdBy.id === currentUserId || canManageStructure(userRole))} onChange={(e) => toggleWeekly(l.id, e.target.checked)} className="h-3 w-3 accent-blue-600" />
                週報
              </label>
            <button
              type="button"
              onClick={() => handleDelete(l.id)}
              className="shrink-0 text-neutral-400 dark:text-neutral-500 hover:text-red-600"
              aria-label="刪除"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
