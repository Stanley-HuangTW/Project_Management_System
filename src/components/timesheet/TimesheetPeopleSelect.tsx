"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Search } from "lucide-react";
import { filterOptions } from "@/lib/searchOptions";
import { departmentState, selectedPeople, toggleDepartment, togglePerson } from "@/lib/peopleSelection";

export type StatsPerson = { id: string; name: string; discipline: string | null };
export type StatsUnit = { code: string; label: string };

/**
 * 統計頁選人員:一個下拉選單,裡面可以搜尋姓名、逐一勾選、全選 / 清除,也可以按部門快速選。
 * value 是 null 代表看得到的全部人(之後新增的人也會自動算進去)。
 */
export function TimesheetPeopleSelect({
  people,
  units,
  value,
  onChange,
}: {
  people: StatsPerson[];
  units: StatsUnit[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const [query, setQuery] = useState("");
  const chosen = selectedPeople(value, people);
  const matches = useMemo(
    () => filterOptions(people.map((p) => ({ ...p, label: p.name })), query),
    [people, query]
  );
  // 只列真的有人在裡面的部門。
  const shownUnits = units.filter((u) => people.some((p) => p.discipline === u.code));
  const hasUnassigned = people.some((p) => !p.discipline || !units.some((u) => u.code === p.discipline));

  const summary =
    value === null
      ? `全部(${people.length})`
      : chosen.length === 0
        ? "沒有選人"
        : chosen.length <= 2
          ? chosen.map((p) => p.name).join("、")
          : `已選 ${chosen.length} / ${people.length} 人`;

  return (
    <Popover.Root onOpenChange={(open) => !open && setQuery("")}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex min-w-[10rem] items-center justify-between gap-2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          <span className="truncate">
            <span className="mr-1 text-xs text-neutral-500 dark:text-neutral-400">人員</span>
            {summary}
          </span>
          <ChevronDown size={14} className="shrink-0 text-neutral-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[60] flex max-h-[28rem] w-[22rem] max-w-[92vw] flex-col overflow-hidden rounded-md border border-neutral-200 bg-white text-sm shadow-md dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-700">
            <Search size={13} className="shrink-0 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋姓名..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
          </div>

          {shownUnits.length > 0 && (
            <div className="shrink-0 space-y-1 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-700">
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500">依部門選取(第一次按只留下該部門,再按可以加上其他部門)</p>
              <div className="flex flex-wrap gap-1">
                {shownUnits.map((u) => {
                  const state = departmentState(value, people, u.code);
                  const count = people.filter((p) => p.discipline === u.code).length;
                  return (
                    <button
                      key={u.code}
                      type="button"
                      onClick={() => onChange(toggleDepartment(value, people, u.code))}
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        state === "all" && value !== null
                          ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                          : state === "some"
                            ? "border-blue-200 text-blue-600 dark:border-blue-900 dark:text-blue-400"
                            : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      }`}
                    >
                      {u.label} {count}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex shrink-0 items-center gap-3 px-3 py-1.5 text-xs">
            <button type="button" onClick={() => onChange(null)} className="text-blue-600 hover:underline dark:text-blue-400">
              全選
            </button>
            <button type="button" onClick={() => onChange([])} className="text-blue-600 hover:underline dark:text-blue-400">
              清除
            </button>
            <span className="ml-auto text-neutral-400 dark:text-neutral-500">
              已選 {chosen.length} / {people.length}
            </span>
          </div>

          <ul
            className="min-h-0 flex-1 overflow-y-auto px-1 pb-1"
            onWheel={(e) => {
              e.stopPropagation();
              e.currentTarget.scrollTop += e.deltaY;
            }}
          >
            {matches.map((p) => {
              const on = value === null || value.includes(p.id);
              const unitLabel = units.find((u) => u.code === p.discipline)?.label;
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <input type="checkbox" checked={on} onChange={() => onChange(togglePerson(value, people, p.id))} />
                    <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">{p.name}</span>
                    {unitLabel && <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">{unitLabel}</span>}
                  </label>
                </li>
              );
            })}
            {matches.length === 0 && (
              <li className="px-2 py-3 text-center text-neutral-400 dark:text-neutral-500">找不到符合的人員</li>
            )}
            {hasUnassigned && query === "" && (
              <li className="px-2 pt-1 text-[11px] text-neutral-400 dark:text-neutral-500">沒有所屬單位的人只能逐一勾選。</li>
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
