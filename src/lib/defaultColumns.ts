import type { ColumnType } from "@prisma/client";
import {
  TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  LINK_OPTIONS,
} from "@/lib/statusDefaults";

export type DefaultColumn = {
  name: string;
  type: ColumnType;
  /** STATUS columns carry their option list here; everything else is {}. */
  options: unknown;
};

/**
 * The columns a new board starts with when nobody has configured otherwise.
 *
 * Matches the project's original imported sheet, plus whatever the dashboard /
 * Gantt / report pages need in order to work with no manual column mapping —
 * createBoard wires those settings up by name straight after creating them.
 *
 * An admin can replace this list from 系統設定, usually by copying an existing
 * board that is already set up the way their projects actually look. This stays
 * as the fallback and as the 恢復內建 target.
 */
export const BUILT_IN_DEFAULT_COLUMNS: DefaultColumn[] = [
  { name: "Lvl", type: "NUMBER", options: {} },
  { name: "Type", type: "STATUS", options: { statuses: TYPE_OPTIONS } },
  { name: "Priority", type: "STATUS", options: { statuses: PRIORITY_OPTIONS } },
  { name: "Status", type: "STATUS", options: { statuses: STATUS_OPTIONS } },
  { name: "Resource", type: "TEXT", options: {} },
  { name: "Pred", type: "TEXT", options: {} },
  { name: "Link", type: "STATUS", options: { statuses: LINK_OPTIONS } },
  { name: "Lag", type: "NUMBER", options: {} },
  { name: "Comment", type: "TEXT", options: {} },
  { name: "Start", type: "DATE", options: {} },
  { name: "Days", type: "NUMBER", options: {} },
  { name: "Finish", type: "DATE", options: {} },
  { name: "% Done", type: "NUMBER", options: {} },
];

const COLUMN_TYPES = new Set<string>([
  "TEXT",
  "NUMBER",
  "DATE",
  "STATUS",
  "PERSON",
  "CHECKBOX",
  "LINK",
  "FILE",
]);

/**
 * The stored setting, back as a usable list.
 *
 * Validated rather than trusted: the column is Json, so a hand-edited row or a
 * list saved by an older version could be any shape at all, and a new board
 * created from a malformed one would be a board with no columns. Anything that
 * does not parse falls back to the built-in list — a board with the standard
 * columns is a recoverable mistake; a board with none is not.
 */
export function parseDefaultColumns(value: unknown): DefaultColumn[] {
  if (!Array.isArray(value) || value.length === 0) return BUILT_IN_DEFAULT_COLUMNS;

  const parsed: DefaultColumn[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { name, type, options } = entry as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) continue;
    if (typeof type !== "string" || !COLUMN_TYPES.has(type)) continue;
    // Two columns of the same name would make createBoard's wiring-by-name
    // ambiguous, and the board itself unreadable.
    const key = name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({
      name: name.trim(),
      type: type as ColumnType,
      options: options && typeof options === "object" ? options : {},
    });
  }

  return parsed.length > 0 ? parsed : BUILT_IN_DEFAULT_COLUMNS;
}
