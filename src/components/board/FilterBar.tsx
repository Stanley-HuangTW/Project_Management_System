"use client";

import { useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import type { ColumnData, UserOption } from "@/types/board";
import { getStatusOptions } from "@/types/column";
import { orgUnitToGroupDiscipline } from "@/lib/groupRoles";
import {
  CREATED_BY_FILTER_COLUMN_ID,
  CREATED_AT_FILTER_COLUMN_ID,
  TODAY_FILTER_VALUE,
  type ActiveFilter,
  type FilterValue,
} from "@/lib/filter";

/** 跟 GroupRolesModal 同一套對外說法——HW 這個列舉值一律叫 EE。 */
const DISCIPLINE_LABEL: Record<string, string> = { SW: "SW", HW: "EE", ME: "ME", QA: "QA", PM: "PM" };
const DISCIPLINE_ORDER = ["SW", "HW", "ME", "QA", "PM"];

type PersonGroup = { key: string; label: string; users: UserOption[] };

/**
 * 負責人篩選的巢狀分組——依組織單位(軟體/硬體/PM……)分,單位對不到職能
 * 的人歸「其他」,Resource(工具/廠商,沒有單位可言)另外自成一組,不跟
 * 真人混在一起。
 */
function groupUsersByDiscipline(users: UserOption[]): PersonGroup[] {
  const byDiscipline = new Map<string, UserOption[]>();
  const other: UserOption[] = [];
  const resources: UserOption[] = [];

  for (const u of users) {
    if (u.isResource) {
      resources.push(u);
      continue;
    }
    const discipline = u.discipline ? orgUnitToGroupDiscipline(u.discipline) : null;
    if (discipline) {
      byDiscipline.set(discipline, [...(byDiscipline.get(discipline) ?? []), u]);
    } else {
      other.push(u);
    }
  }

  const groups: PersonGroup[] = DISCIPLINE_ORDER.filter((d) => byDiscipline.has(d)).map((d) => ({
    key: d,
    label: DISCIPLINE_LABEL[d],
    users: byDiscipline.get(d)!,
  }));
  if (other.length > 0) groups.push({ key: "OTHER", label: "其他", users: other });
  if (resources.length > 0) groups.push({ key: "RESOURCE", label: "資源", users: resources });
  return groups;
}

// Synthetic entries appended to the real board columns so "任務分派者"/
// "任務新增時間" (Item.createdById/createdAt) are filterable without being
// real, visible table columns — see CREATED_BY_FILTER_COLUMN_ID.
const VIRTUAL_COLUMNS: ColumnData[] = [
  { id: CREATED_BY_FILTER_COLUMN_ID, boardId: "", name: "任務分派者", type: "PERSON", options: {}, order: 1e6 },
  { id: CREATED_AT_FILTER_COLUMN_ID, boardId: "", name: "任務新增時間", type: "DATE", options: {}, order: 1e6 + 1 },
];

function defaultValueFor(type: ColumnData["type"]): FilterValue {
  switch (type) {
    case "STATUS":
      return { kind: "status", selected: [] };
    case "PERSON":
      return { kind: "person", selected: [] };
    case "NUMBER":
      return { kind: "number", min: null, max: null };
    case "DATE":
      return { kind: "date", from: null, to: null };
    default:
      return { kind: "text", query: "" };
  }
}

export function FilterBar({
  columns,
  users,
  filters,
  onChange,
}: {
  columns: ColumnData[];
  users: UserOption[];
  filters: ActiveFilter[];
  onChange: (filters: ActiveFilter[]) => void;
}) {
  const allColumns = [...columns, ...VIRTUAL_COLUMNS];

  function addFilter() {
    const firstColumn = allColumns[0];
    if (!firstColumn) return;
    onChange([...filters, { columnId: firstColumn.id, value: defaultValueFor(firstColumn.type) }]);
  }

  function updateFilter(index: number, next: ActiveFilter) {
    onChange(filters.map((f, i) => (i === index ? next : f)));
  }

  function removeFilter(index: number) {
    onChange(filters.filter((_, i) => i !== index));
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {filters.map((filter, index) => {
        const column = allColumns.find((c) => c.id === filter.columnId);
        if (!column) return null;
        return (
          <div
            key={index}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1"
          >
            <select
              value={filter.columnId}
              onChange={(e) => {
                const col = allColumns.find((c) => c.id === e.target.value);
                if (col) updateFilter(index, { columnId: col.id, value: defaultValueFor(col.type) });
              }}
              className="rounded border-none bg-white dark:bg-neutral-900 text-xs font-medium text-neutral-700 dark:text-neutral-100 outline-none"
            >
              {allColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <FilterValueControl
              column={column}
              value={filter.value}
              users={users}
              onChange={(value) => updateFilter(index, { columnId: filter.columnId, value })}
            />
            <button
              type="button"
              onClick={() => removeFilter(index)}
              className="text-neutral-400 dark:text-neutral-500 hover:text-red-600"
              aria-label="移除篩選"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={addFilter}
        className="flex items-center gap-1 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-100"
      >
        <Plus size={14} /> 篩選
      </button>
    </div>
  );
}

function FilterValueControl({
  column,
  value,
  users,
  onChange,
}: {
  column: ColumnData;
  value: FilterValue;
  users: UserOption[];
  onChange: (value: FilterValue) => void;
}) {
  if (value.kind === "text") {
    return (
      <input
        value={value.query}
        onChange={(e) => onChange({ kind: "text", query: e.target.value })}
        placeholder="包含文字..."
        className="w-28 rounded border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 px-1.5 py-0.5 text-xs outline-none focus:border-blue-500"
      />
    );
  }

  if (value.kind === "status") {
    const options = getStatusOptions(column.options);
    return (
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const active = value.selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() =>
                onChange({
                  kind: "status",
                  selected: active
                    ? value.selected.filter((id) => id !== o.id)
                    : [...value.selected, o.id],
                })
              }
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                active ? "text-white" : "border border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400"
              }`}
              style={active ? { backgroundColor: o.color } : undefined}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (value.kind === "person") {
    return (
      <PersonFilterDropdown
        users={users}
        selected={value.selected}
        onChange={(selected) => onChange({ kind: "person", selected })}
      />
    );
  }

  if (value.kind === "number") {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value.min ?? ""}
          onChange={(e) =>
            onChange({
              kind: "number",
              min: e.target.value === "" ? null : Number(e.target.value),
              max: value.max,
            })
          }
          placeholder="最小"
          className="w-14 rounded border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 px-1 py-0.5 text-xs outline-none focus:border-blue-500"
        />
        <span className="text-neutral-400 dark:text-neutral-500">~</span>
        <input
          type="number"
          value={value.max ?? ""}
          onChange={(e) =>
            onChange({
              kind: "number",
              min: value.min,
              max: e.target.value === "" ? null : Number(e.target.value),
            })
          }
          placeholder="最大"
          className="w-14 rounded border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 px-1 py-0.5 text-xs outline-none focus:border-blue-500"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <DateBound bound={value.from} onChange={(from) => onChange({ kind: "date", from, to: value.to })} />
      <span className="text-neutral-400 dark:text-neutral-500">~</span>
      <DateBound bound={value.to} onChange={(to) => onChange({ kind: "date", from: value.from, to })} />
    </div>
  );
}

/**
 * One end of a date range: a fixed day, or "今天".
 *
 * "今天" is what makes a saved view like 我的逾期任務 still right tomorrow —
 * a fixed date would freeze the day it was saved on.
 */
function DateBound({
  bound,
  onChange,
}: {
  bound: string | null;
  onChange: (bound: string | null) => void;
}) {
  if (bound === TODAY_FILTER_VALUE) {
    return (
      <button
        type="button"
        onClick={() => onChange(null)}
        className="flex items-center gap-1 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-1.5 py-0.5 text-xs text-blue-700 dark:text-blue-300"
        title="改回指定日期"
      >
        今天 <X size={10} />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-0.5">
      <input
        type="date"
        value={bound ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-32 rounded border border-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 px-1 py-0.5 text-xs outline-none focus:border-blue-500"
      />
      <button
        type="button"
        onClick={() => onChange(TODAY_FILTER_VALUE)}
        className="rounded px-1 py-0.5 text-[11px] text-neutral-400 dark:text-neutral-500 hover:text-blue-600"
        title="改用「今天」,存成檢視後每天自動跟著今天走"
      >
        今天
      </button>
    </span>
  );
}

/**
 * 負責人篩選——下拉選單取代一長排人名圓角標籤,面板裡依組織單位分組、
 * 可各自收合展開,組內逐人勾選,支援複選。
 */
function PersonFilterDropdown({
  users,
  selected,
  onChange,
}: {
  users: UserOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const groups = useMemo(() => groupUsersByDiscipline(users), [users]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleUser(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const selectedNames = users.filter((u) => selected.includes(u.id)).map((u) => u.name);
  const label =
    selectedNames.length === 0 ? "全部" : selectedNames.length <= 2 ? selectedNames.join("、") : `${selectedNames.length} 人`;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex max-w-[160px] items-center gap-1 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 outline-none hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown size={11} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          className="z-50 max-h-80 w-64 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1 shadow-md"
          onWheel={(e) => {
            e.stopPropagation();
            e.currentTarget.scrollTop += e.deltaY;
          }}
        >
          {groups.length === 0 && (
            <p className="px-2 py-2 text-xs text-neutral-400 dark:text-neutral-500">沒有可選的人</p>
          )}
          {groups.map((group) => {
            const isOpen = expanded.has(group.key);
            const selectedInGroup = group.users.filter((u) => selected.includes(u.id)).length;
            return (
              <div key={group.key}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <ChevronRight
                    size={11}
                    className={`shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                  <span className="shrink-0 text-[10px] font-normal text-neutral-400 dark:text-neutral-500">
                    {selectedInGroup > 0 ? `${selectedInGroup}/${group.users.length}` : group.users.length}
                  </span>
                </button>
                {isOpen && (
                  <div className="pl-4">
                    {group.users.map((u) => {
                      const active = selected.includes(u.id);
                      return (
                        <DropdownMenu.Item
                          key={u.id}
                          onSelect={(e) => {
                            e.preventDefault();
                            toggleUser(u.id);
                          }}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-neutral-700 dark:text-neutral-100 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          <input type="checkbox" checked={active} readOnly className="h-3 w-3" />
                          <span className="min-w-0 flex-1 truncate">{u.name}</span>
                        </DropdownMenu.Item>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
