"use client";

import { PersonPicker } from "@/components/ui/PersonPicker";
import type { UserOption } from "@/types/board";
import { useRecordedCellSave } from "./useCellSave";

export function PersonCell({
  boardId,
  itemId,
  columnId,
  value,
  users,
}: {
  boardId: string;
  itemId: string;
  columnId: string;
  value: string | null;
  users: UserOption[];
}) {
  const save = useRecordedCellSave();
  return (
    <PersonPicker
      users={users}
      selectedId={value}
      placeholder="未指派"
      unassignedLabel="未指派"
      onSelect={(userId) => save({ boardId, itemId, columnId, before: value, after: userId })}
    />
  );
}
