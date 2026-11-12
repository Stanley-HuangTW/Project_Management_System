import type { ColumnData, ItemData, UserOption } from "@/types/board";
import { getStatusOptions } from "@/types/column";
import { TextCell } from "./TextCell";
import { StatusCell } from "./StatusCell";
import { PersonCell } from "./PersonCell";
import { DateCell } from "./DateCell";
import { NumberCell } from "./NumberCell";
import { PredCell } from "./PredCell";
import { withWeekday } from "@/lib/weekdayLabel";

function ReadOnlyCell({
  column,
  value,
  users,
  isProgressColumn,
  showWeekday = false,
}: {
  column: ColumnData;
  value: string | number | null;
  users: UserOption[];
  isProgressColumn: boolean;
  /** 項目卡片裡日期後面接星期幾(表格裡格子很窄,不加)。 */
  showWeekday?: boolean;
}) {
  if (column.type === "STATUS") {
    const option = getStatusOptions(column.options).find((o) => o.id === value);
    if (!option) return <span className="block px-2 py-1" />;
    return (
      <span
        title={option.label}
        className="mx-2 flex h-7 items-center truncate rounded px-2 text-xs font-medium text-white"
        style={{ backgroundColor: option.color }}
      >
        {option.label}
      </span>
    );
  }

  let display = "";
  if (column.type === "PERSON") {
    display = users.find((u) => u.id === value)?.name ?? "";
  } else if (isProgressColumn && column.type === "NUMBER" && typeof value === "number") {
    display = `${Math.round(value * 100)}%`;
  } else if (showWeekday && column.type === "DATE" && typeof value === "string") {
    display = withWeekday(value);
  } else if (value !== null) {
    display = String(value);
  }
  return (
    <span className="block truncate px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400" title={display}>
      {display}
    </span>
  );
}

export function CellEditor({
  boardId,
  itemId,
  column,
  value,
  users,
  canEdit = true,
  isProgressColumn = false,
  bordered = false,
  predColumnId,
  groupItems,
  crossGroupPredOptions,
  wbsCodes,
}: {
  boardId: string;
  itemId: string;
  column: ColumnData;
  value: string | number | null;
  users: UserOption[];
  canEdit?: boolean;
  isProgressColumn?: boolean;
  /** 卡片裡要畫出輸入框,表格裡不要 —— 見 cellFieldClass。 */
  bordered?: boolean;
  /** When column is the board's designated Pred column and groupItems is
   *  given, Pred renders as a dropdown of the item's group siblings instead
   *  of a free-text WBS code field. */
  predColumnId?: string | null;
  groupItems?: ItemData[];
  /** Other groups' items, for a cross-group Pred — see PredCell. */
  crossGroupPredOptions?: { id: string; code: string; name: string }[];
  /** Passed straight through to PredCell — see its own doc comment. */
  wbsCodes?: Map<string, string>;
}) {
  if (!canEdit) {
    return <ReadOnlyCell column={column} value={value} users={users} isProgressColumn={isProgressColumn} showWeekday={bordered} />;
  }

  if (column.id === predColumnId && groupItems) {
    return (
      <PredCell
        boardId={boardId}
        itemId={itemId}
        columnId={column.id}
        value={typeof value === "string" ? value : null}
        groupItems={groupItems}
        crossGroupPredOptions={crossGroupPredOptions}
        wbsCodes={wbsCodes}
      />
    );
  }

  switch (column.type) {
    case "TEXT":
      return (
        <TextCell
          boardId={boardId}
          itemId={itemId}
          columnId={column.id}
          value={typeof value === "string" ? value : ""}
          bordered={bordered}
        />
      );
    case "NUMBER":
      return (
        <NumberCell
          boardId={boardId}
          itemId={itemId}
          columnId={column.id}
          value={typeof value === "number" ? value : null}
          percent={isProgressColumn}
          bordered={bordered}
        />
      );
    case "DATE":
      return (
        <DateCell
          boardId={boardId}
          itemId={itemId}
          columnId={column.id}
          value={typeof value === "string" ? value : null}
          bordered={bordered}
        />
      );
    case "PERSON":
      return (
        <PersonCell
          boardId={boardId}
          itemId={itemId}
          columnId={column.id}
          value={typeof value === "string" ? value : null}
          users={users}
        />
      );
    case "STATUS":
      return (
        <StatusCell
          boardId={boardId}
          itemId={itemId}
          columnId={column.id}
          value={typeof value === "string" ? value : null}
          options={column.options}
        />
      );
    default:
      return null;
  }
}
