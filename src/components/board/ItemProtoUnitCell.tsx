"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Search } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { setItemProtoUnits } from "@/lib/actions/itemProtoUnits";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { useItemProtoUnits, type ProtoUnitOption } from "./ItemProtoUnitsContext";

const cellBase = "flex h-full min-w-0 items-center border-r border-neutral-100 px-2 dark:border-neutral-700";

/** 這個工作項用到的樣機,縮成一行:第一台的名字,多的寫「等 N 台」。 */
function summarise(picked: ProtoUnitOption[]): string {
  if (picked.length === 0) return "";
  return picked.length === 1 ? picked[0].label : `${picked[0].label} 等 ${picked.length} 台`;
}

/**
 * 表格的「使用樣機」欄:這個工作項(例如測試項目)用到樣機計畫排出來的哪幾台。
 * 點一下開選單,勾要用的樣機(依產品 → 階段分組,可以搜尋),關掉選單時存檔。
 * 沒有編輯權限的人只看得到、不能改。
 */
export function ItemProtoUnitCell({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const data = useItemProtoUnits();
  const { notify } = useDialogs();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  const options = data?.options ?? [];
  const saved = data?.byItem[itemId] ?? [];
  const byId = new Map(options.map((o) => [o.id, o]));
  const picked = saved.map((id) => byId.get(id)).filter((o): o is ProtoUnitOption => !!o);

  // 這個看板沒有排任何樣機:沒東西可選,也沒東西可看。
  if (options.length === 0 && picked.length === 0) {
    return (
      <div className={cellBase} data-proto-units-item={itemId}>
        <span className="text-xs text-neutral-300 dark:text-neutral-600">—</span>
      </div>
    );
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(saved);
      setQuery("");
    } else {
      const changed = draft.length !== saved.length || draft.some((id) => !saved.includes(id));
      if (changed) void save(draft);
    }
    setOpen(next);
  }

  async function save(ids: string[]) {
    try {
      const result = await setItemProtoUnits(itemId, ids);
      if (result.error) await notify(result.error, { title: "無法儲存「使用樣機」" });
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "儲存失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : "無法儲存「使用樣機」" }
      );
    }
  }

  const text = summarise(picked);
  const title = picked.length > 0 ? picked.map((p) => p.label).join("\n") : undefined;

  if (!canEdit) {
    return (
      <div className={cellBase} data-proto-units-item={itemId}>
        {text ? (
          <span className="truncate text-xs text-neutral-700 dark:text-neutral-200" title={title}>
            {text}
          </span>
        ) : (
          <span className="text-xs text-neutral-300 dark:text-neutral-600">—</span>
        )}
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const matches = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  // 產品 → 階段 分組(options 已經照產品、階段順序排好)。
  const groups: { key: string; title: string; items: ProtoUnitOption[] }[] = [];
  for (const o of matches) {
    const key = `${o.product}\u0000${o.phaseId}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(o);
    else groups.push({ key, title: `${o.product} / ${o.phaseName}`, items: [o] });
  }

  return (
    <div className={cellBase} data-proto-units-item={itemId}>
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger asChild>
          <button
            type="button"
            title={title ?? "選這個工作項用到的樣機"}
            aria-label="使用樣機"
            className="flex min-w-0 flex-1 items-center rounded px-1 py-0.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {text ? (
              <span className="truncate text-neutral-700 dark:text-neutral-200">{text}</span>
            ) : (
              <span className="text-neutral-300 dark:text-neutral-600">選樣機…</span>
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 flex max-h-80 w-72 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white shadow-md dark:border-neutral-700 dark:bg-neutral-900"
          >
            <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-700">
              <Search size={13} className="shrink-0 text-neutral-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜尋樣機(產品、階段、用途)..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
              />
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto p-1"
              // 常常是從 Modal 裡面開出來的——Modal 會鎖住背景捲動,連帶把這裡的滾輪也擋掉(PersonPicker 同一個做法)。
              onWheel={(e) => {
                e.stopPropagation();
                e.currentTarget.scrollTop += e.deltaY;
              }}
            >
              {groups.map((group) => (
                <div key={group.key} className="mb-1">
                  <p className="px-2 py-1 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">{group.title}</p>
                  {group.items.map((o) => (
                    <label
                      key={o.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <input
                        type="checkbox"
                        checked={draft.includes(o.id)}
                        onChange={() =>
                          setDraft((prev) => (prev.includes(o.id) ? prev.filter((id) => id !== o.id) : [...prev, o.id]))
                        }
                        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {o.unit} #{o.seq}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
              {matches.length === 0 && (
                <p className="px-2 py-3 text-center text-sm text-neutral-400 dark:text-neutral-500">
                  {options.length === 0 ? "樣機計畫還沒有排任何台數" : "找不到符合的樣機"}
                </p>
              )}
            </div>
            <p className="shrink-0 border-t border-neutral-100 px-2 py-1 text-[11px] text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
              已選 {draft.length} 台・關掉選單時存檔
            </p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
