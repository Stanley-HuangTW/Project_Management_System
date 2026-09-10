"use client";

import { Plus, X } from "lucide-react";
import type { ColumnData, UserOption } from "@/types/board";
import { getStatusOptions } from "@/types/column";
import {
  CREATED_BY_FILTER_COLUMN_ID,
  CREATED_AT_FILTER_COLUMN_ID,
  TODAY_FILTER_VALUE,
  type ActiveFilter,
  type FilterValue,
} from "@/lib/filter";

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
              className="rounded border-none bg-transparent text-xs font-medium text-neutral-700 dark:text-neutral-100 outline-none"
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
      <div className="flex max-w-xs flex-wrap gap-1">
        {users.map((u) => {
          const active = value.selected.includes(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() =>
                onChange({
                  kind: "person",
                  selected: active
                    ? value.selected.filter((id) => id !== u.id)
                    : [...value.selected, u.id],
                })
              }
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                active
                  ? "bg-neutral-800 text-white"
                  : "border border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {u.name}
            </button>
          );
        })}
      </div>
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
