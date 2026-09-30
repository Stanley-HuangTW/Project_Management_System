"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ItemData } from "@/types/board";
import type { UserRole } from "@prisma/client";
import { canManageStructure } from "@/lib/permissions";
import { isItemAssignedToUser } from "@/lib/itemAssignment";

export function KanbanCard({
  item,
  userRole,
  currentUserId,
  personColumnIds,
  wbsCode,
  isOpening,
  onOpenDetail,
}: {
  item: ItemData;
  userRole: UserRole;
  currentUserId: string;
  personColumnIds: string[];
  wbsCode: string;
  isOpening: boolean;
  onOpenDetail: (itemId: string) => void;
}) {
  const canDrag = canManageStructure(userRole) || isItemAssignedToUser(item, personColumnIds, currentUserId);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id, data: { type: "card" }, disabled: !canDrag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-kanban-card
      title={canDrag ? undefined : "只能移動自己被指派或負責的項目"}
      className={`rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm shadow-sm hover:border-neutral-300 dark:hover:border-neutral-600 ${
        canDrag ? "cursor-grab" : "cursor-default"
      }`}
    >
      <button
        type="button"
        disabled={isOpening}
        onClick={() => onOpenDetail(item.id)}
        title={item.name}
        className="w-full min-w-0 truncate text-left text-neutral-800 hover:text-blue-600 hover:underline disabled:opacity-60 dark:text-neutral-100"
      >
        {wbsCode && (
          <span className="mr-1.5 text-xs tabular-nums text-neutral-400 dark:text-neutral-500">{wbsCode}</span>
        )}
        {item.name}
      </button>
    </div>
  );
}
