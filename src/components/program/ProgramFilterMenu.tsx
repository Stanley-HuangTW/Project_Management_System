"use client";

import { useMemo } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Filter } from "lucide-react";
import type { ProgramTask } from "@/lib/programView";
import {
  NO_VALUE,
  PROGRAM_FILTER_FIELDS,
  isProgramFilterActive,
  type ProgramFilter,
  type ProgramFilterField,
} from "@/lib/programFilter";

type Option = { value: string; label: string; count: number };

/** 這個群組裡實際出現過的值 —— 沒有人用的選項列出來只會篩出一片空白。 */
function optionsOf(tasks: ProgramTask[], field: ProgramFilterField): Option[] {
  const counts = new Map<string, Option>();
  const add = (value: string, label: string) => {
    const existing = counts.get(value);
    if (existing) existing.count += 1;
    else counts.set(value, { value, label, count: 1 });
  };
  for (const task of tasks) {
    if (field === "assignee") {
      if (task.assigneeIds.length === 0) add(NO_VALUE, "(未指派)");
      task.assigneeIds.forEach((id, i) => add(id, task.assigneeNames[i] ?? id));
    } else {
      const value = task[field];
      if (value === null) add(NO_VALUE, "(未設定)");
      else add(value, value);
    }
  }
  const all = [...counts.values()];
  // 「沒填」永遠排最後;其餘照名稱排,負責人才找得到人。
  return [
    ...all.filter((o) => o.value !== NO_VALUE).sort((a, b) => a.label.localeCompare(b.label, "zh-Hant")),
    ...all.filter((o) => o.value === NO_VALUE),
  ];
}

/**
 * 群組甘特圖的「篩選」:依工作項的欄位值決定要顯示哪些列。
 *
 * 選項是從資料裡長出來的而不是寫死 —— 每塊看板的類型、狀態選項都可以
 * 自己改,寫死的清單遲早會漏。
 */
export function ProgramFilterMenu({
  tasks,
  filter,
  onChange,
}: {
  tasks: ProgramTask[];
  filter: ProgramFilter;
  onChange: (next: ProgramFilter) => void;
}) {
  const options = useMemo(
    () => Object.fromEntries(PROGRAM_FILTER_FIELDS.map(({ field }) => [field, optionsOf(tasks, field)])),
    [tasks]
  ) as Record<ProgramFilterField, Option[]>;

  const activeFieldCount = PROGRAM_FILTER_FIELDS.filter(({ field }) => filter[field].length > 0).length;
  const active = isProgramFilterActive(filter);

  function toggle(field: ProgramFilterField, value: string) {
    const current = filter[field];
    onChange({
      ...filter,
      [field]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    });
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="依工作項的類型、狀態、優先級、負責人決定要顯示哪些"
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
            active
              ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
          }`}
        >
          <Filter size={12} /> 篩選{active && ` (${activeFieldCount})`}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 flex max-h-96 w-72 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white shadow-md dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {PROGRAM_FILTER_FIELDS.map(({ field, label }) => (
              <fieldset key={field}>
                <legend className="mb-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                  {label}
                </legend>
                <div className="flex flex-wrap gap-1">
                  {options[field].map((o) => {
                    const on = filter[field].includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(field, o.value)}
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          on
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        }`}
                      >
                        {o.label}
                        <span className={`ml-1 tabular-nums ${on ? "text-blue-100" : "text-neutral-400"}`}>
                          {o.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            <span>同欄多選=或者,不同欄=而且;符合的項目會連上層一起顯示</span>
            {active && (
              <button
                type="button"
                onClick={() => onChange({ type: [], status: [], priority: [], assignee: [] })}
                className="shrink-0 pl-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                清除
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
