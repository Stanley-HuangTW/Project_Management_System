"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { saveDashboardBoardFilter } from "@/lib/actions/dashboardFilter";
import { boardFilterSummary } from "@/lib/dashboardBoardFilter";

const rowClass =
  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800";

/**
 * 儀表板的看板篩選:可以勾好幾個看板,按「套用」之後記住(下次打開還是這幾個)。
 * 一個都不勾就是全部看板。用 Popover 不用 DropdownMenu——選單項目會搶焦點,勾選框不好點(PersonPicker 同一個考量)。
 */
export function DashboardBoardFilter({
  boards,
  selectedIds,
}: {
  boards: { id: string; name: string }[];
  selectedIds: string[];
}) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [draft, setDraft] = useState<string[]>(selectedIds);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function apply() {
    startTransition(async () => {
      const result = await saveDashboardBoardFilter(draft);
      if (result.error) {
        await notify(result.error, { title: "無法套用看板篩選" });
        return;
      }
      // 網址上如果還留著舊的 ?board=,它會蓋過剛記下來的——一律回到乾淨的 /dashboard。
      router.replace("/dashboard");
    });
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-neutral-500 dark:text-neutral-400">看板篩選</span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label="看板篩選"
            className="flex w-64 items-center gap-2 rounded-md border border-neutral-300 px-2 py-1.5 text-left outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
          >
            <span className="min-w-0 flex-1 truncate">{boardFilterSummary(draft, boards)}</span>
            <ChevronDown size={14} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 max-h-72 w-64 overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 shadow-md dark:border-neutral-700 dark:bg-neutral-900"
          >
            <label className={rowClass}>
              <input
                type="checkbox"
                checked={draft.length === 0}
                onChange={() => setDraft([])}
                className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600"
              />
              <span className="min-w-0 flex-1 truncate">全部看板</span>
            </label>
            <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
            {boards.map((board) => (
              <label key={board.id} className={rowClass}>
                <input
                  type="checkbox"
                  checked={draft.includes(board.id)}
                  onChange={() => toggle(board.id)}
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600"
                />
                <span className="min-w-0 flex-1 truncate" title={board.name}>
                  {board.name}
                </span>
              </label>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <button
        type="button"
        onClick={apply}
        disabled={pending}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        套用
      </button>
    </div>
  );
}
