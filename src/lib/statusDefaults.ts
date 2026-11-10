import type { StatusOption } from "@/types/column";

/**
 * The colours every new board's STATUS columns start with, and what
 * 「回復預設」 puts back.
 *
 * They live here rather than inline in board creation so the settings page
 * can show the same table it would restore — a default nobody can see is a
 * default nobody can decide to keep.
 */

export const TYPE_OPTIONS: StatusOption[] = [
  { id: "summary", label: "Summary", color: "#00c875" },
  { id: "milestone", label: "Milestone", color: "#e2445c" },
  { id: "task", label: "Task", color: "#a25ddc" },
];

/** Red for the one that will hurt, purple for the middle, green for routine
 *  — the order people already read a traffic light in. */
export const PRIORITY_OPTIONS: StatusOption[] = [
  { id: "critical", label: "CRITICAL", color: "#e2445c" },
  { id: "high", label: "HIGH", color: "#a25ddc" },
  { id: "normal", label: "NORMAL", color: "#00c875" },
];

// Same labels as the project's original imported sheet, but the "done"/
// "in_progress" ids match DEFAULT_STATUSES so isItemComplete's built-in
// fallback (and 報表設定) recognize completion without any manual setup.
export const STATUS_OPTIONS: StatusOption[] = [
  { id: "planned", label: "Planned", color: "#00c875" },
  { id: "in_progress", label: "In Progress", color: "#a25ddc" },
  { id: "done", label: "Completed", color: "#e2445c" },
  { id: "pending", label: "Pending", color: "#c4c4c4" },
];

export const LINK_OPTIONS: StatusOption[] = [
  { id: "fs", label: "FS", color: "#00c875" },
  { id: "ff", label: "FF", color: "#e2445c" },
  { id: "ss", label: "SS", color: "#a25ddc" },
  { id: "sf", label: "SF", color: "#579bfc" },
];

/** Keyed by column name, since that is what a board actually has — an
 *  imported board's ids are whatever the sheet had. */
export const DEFAULT_STATUS_COLORS: Record<string, StatusOption[]> = {
  Type: TYPE_OPTIONS,
  Priority: PRIORITY_OPTIONS,
  Status: STATUS_OPTIONS,
  Link: LINK_OPTIONS,
};

/**
 * The default colour for one option of one column, matched by label.
 *
 * Matched by label rather than id because an imported board's option ids
 * come from the sheet: the Priority column on a real board has ids like
 * "073a5fd3", but its labels are still CRITICAL/HIGH/NORMAL.
 */
export function defaultColorFor(columnName: string, optionLabel: string): string | null {
  const options = DEFAULT_STATUS_COLORS[columnName.trim()];
  if (!options) return null;
  const match = options.find((o) => o.label.toLowerCase() === optionLabel.trim().toLowerCase());
  return match?.color ?? null;
}
