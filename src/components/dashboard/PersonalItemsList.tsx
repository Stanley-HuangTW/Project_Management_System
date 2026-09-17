"use client";

import { useMemo, useState } from "react";
import type { UserRole } from "@prisma/client";
import type { PersonalItemEntry } from "@/lib/dashboard";
import type { UserOption } from "@/types/board";
import { PersonalItemRow } from "./PersonalItemRow";
import { HScrollPane } from "@/components/ui/HScrollPane";

type ColKey = "name" | "window" | "board" | "status" | "progress" | "date";
type FilterKey = ColKey | "group";

const MIN_WIDTH = 60;
const DEFAULT_WIDTHS: Record<ColKey, number> = {
  name: 320,
  window: 140,
  board: 140,
  status: 110,
  progress: 64,
  date: 130,
};

const COL_LABEL: Record<ColKey, string> = {
  name: "項目名稱",
  window: "窗口",
  board: "看板",
  status: "狀態",
  progress: "進度",
  date: "日期",
};

/** Items with no status recognized as planned/in-progress/completed sort
 *  after "completed" but their own relative (due-date) order is preserved —
 *  this only reorders the three recognized buckets, it doesn't invent a
 *  4th tier ahead of them. */
function statusRank(status: PersonalItemEntry["status"]): number {
  if (!status) return 3;
  const label = status.label.toLowerCase();
  if (/完成|done|complete/.test(label)) return 2;
  if (/進行中|in.?progress|doing/.test(label)) return 1;
  if (/計畫|規劃|未開始|待處理|planned?|pending|to.?do/.test(label)) return 0;
  return 3;
}

export function PersonalItemsList({
  items,
  showAssignees,
  userRole,
  currentUserId,
  users,
  assignableUsers,
  emptyText,
}: {
  items: PersonalItemEntry[];
  showAssignees: boolean;
  userRole: UserRole;
  currentUserId: string;
  users: UserOption[];
  assignableUsers: UserOption[];
  emptyText: string;
}) {
  const [widths, setWidths] = useState<Record<ColKey, number>>(DEFAULT_WIDTHS);
  const [filterField, setFilterField] = useState<FilterKey | "">("");
  const [filterValue, setFilterValue] = useState("");

  const columns: ColKey[] = showAssignees
    ? ["name", "window", "board", "status", "progress", "date"]
    : ["name", "board", "status", "progress", "date"];

  function fieldValue(item: PersonalItemEntry, field: FilterKey): string {
    switch (field) {
      case "board":
        return item.boardName;
      case "status":
        return item.status?.label ?? "狀態未設置";
      case "window":
        return item.assignees.map((a) => a.name).join(", ") || "—";
      case "group":
        return item.groupName || "—";
      default:
        return "";
    }
  }

  const filterOptions = useMemo(() => {
    if (!filterField || filterField === "name" || filterField === "progress" || filterField === "date") {
      return [];
    }
    const field = filterField;
    return [...new Set(items.map((item) => fieldValue(item, field)))].sort();
  }, [items, filterField]);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const rankDiff = statusRank(a.status) - statusRank(b.status);
      if (rankDiff !== 0) return rankDiff;
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
    });
  }, [items]);

  const filtered =
    filterField && filterValue
      ? sorted.filter((item) => fieldValue(item, filterField) === filterValue)
      : sorted;

  function startResize(col: ColKey, e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widths[col];
    function onMove(ev: PointerEvent) {
      const next = startWidth + (ev.clientX - startX);
      setWidths((prev) => ({ ...prev, [col]: Math.max(MIN_WIDTH, next) }));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const gridTemplate = columns.map((c) => `${widths[c]}px`).join(" ") + " 32px";

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="text-neutral-500 dark:text-neutral-400">篩選</span>
        <select
          value={filterField}
          onChange={(e) => {
            setFilterField(e.target.value as FilterKey | "");
            setFilterValue("");
          }}
          className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500"
        >
          <option value="">不篩選</option>
          <option value="board">看板</option>
          <option value="group">分項</option>
          <option value="status">狀態</option>
          {showAssignees && <option value="window">窗口</option>}
        </select>
        {filterField && (
          <select
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500"
          >
            <option value="">全部</option>
            {filterOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
      </div>

      <HScrollPane className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
        <div
          className="grid items-center border-b border-neutral-100 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {columns.map((col) => (
            <div key={col} className="relative truncate pr-2">
              {COL_LABEL[col]}
              <div
                onPointerDown={(e) => startResize(col, e)}
                className="absolute right-0 top-1/2 h-4 w-1 -translate-y-1/2 cursor-col-resize hover:bg-blue-400"
              />
            </div>
          ))}
          <div />
        </div>

        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-neutral-400 dark:text-neutral-500">{emptyText}</p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
            {filtered.map((item) => (
              <PersonalItemRow
                key={`${item.boardId}-${item.itemId}`}
                item={item}
                showAssignees={showAssignees}
                userRole={userRole}
                currentUserId={currentUserId}
                users={users}
                assignableUsers={assignableUsers}
                widths={widths}
              />
            ))}
          </ul>
        )}
      </HScrollPane>
    </div>
  );
}
