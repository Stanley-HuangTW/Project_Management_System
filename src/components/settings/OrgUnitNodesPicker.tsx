"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import { flattenOrgForest, type OrgNodeLite } from "@/lib/orgTree";

/**
 * 一個組織單位對應哪些組織架構圖部門:點開來勾(可以複選,依上下層縮排),按「套用」才存。
 * 部門旁邊的小字是它同時對應的其它單位——一個部門可以對應好幾個單位。
 */
export function OrgUnitNodesPicker({
  unitCode,
  unitName,
  nodes,
  selectedIds,
  disabled,
  onApply,
}: {
  unitCode: string;
  /** 顯示名稱,例如「EE 電機」。 */
  unitName: string;
  nodes: OrgNodeLite[];
  selectedIds: string[];
  disabled: boolean;
  onApply: (nodeIds: string[]) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const tree = useMemo(() => flattenOrgForest(nodes), [nodes]);

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(selectedIds);
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled || nodes.length === 0}
          aria-label={`${unitCode} 對應部門`}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-xs text-neutral-600 outline-none hover:bg-neutral-50 focus:border-blue-500 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {nodes.length === 0 ? "還沒有部門" : selectedIds.length === 0 ? "+ 選擇部門…" : "修改"}
          <ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          data-unit-picker={unitCode}
          className="z-50 w-80 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <p className="mb-1 px-1 text-xs font-medium text-neutral-800 dark:text-neutral-100">{unitName} 對應的部門(可複選)</p>
          <ul className="max-h-64 overflow-auto">
            {tree.map(({ node, depth }) => {
              const others = (node.unitCodes ?? []).filter((code) => code !== unitCode);
              return (
                <li key={node.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800">
                    <input type="checkbox" checked={draft.includes(node.id)} onChange={() => toggle(node.id)} />
                    <span className="min-w-0 flex-1 truncate" style={{ paddingLeft: (depth - 1) * 12 }}>
                      {node.name}
                    </span>
                    {others.length > 0 && (
                      <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">也對應:{others.join("、")}</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-end gap-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              取消
            </button>
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await onApply(draft);
              }}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              套用
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
