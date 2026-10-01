"use client";

import { useState } from "react";
import { MessageSquare, Plus, Trash2, UserPlus } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { canManageStructure, canModifyItemSchedule } from "@/lib/permissions";
import { useDeleteItem } from "@/components/board/useDeleteItem";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { ItemDetailModal } from "@/components/board/ItemDetailModal";
import { AssignmentModal } from "@/components/board/AssignmentModal";
import { AddSubtaskModal } from "./AddSubtaskModal";
import type { PersonalItemEntry } from "@/lib/dashboard";
import type { UserOption } from "@/types/board";

function formatDate(date: Date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export function PersonalItemRow({
  item,
  showAssignees,
  userRole,
  currentUserId,
  users,
  assignableUsers,
  widths,
}: {
  item: PersonalItemEntry;
  showAssignees: boolean;
  userRole: UserRole;
  currentUserId: string;
  users: UserOption[];
  assignableUsers: UserOption[];
  widths: Record<"name" | "window" | "board" | "status" | "progress" | "date", number>;
}) {
  const canManage = canManageStructure(userRole);
  const canDelete = canModifyItemSchedule(userRole, item.createdById, currentUserId);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"updates" | "card">("card");
  const requestDelete = useDeleteItem();
  const [assignOpen, setAssignOpen] = useState(false);
  const [addSubtaskOpen, setAddSubtaskOpen] = useState(false);
  const commentCount = item.fullItem._count.comments;
  const assignmentCount = item.fullItem.assignments.length;

  const columns: (keyof typeof widths)[] = showAssignees
    ? ["name", "window", "board", "status", "progress", "date"]
    : ["name", "board", "status", "progress", "date"];
  const gridTemplate = columns.map((c) => `${widths[c]}px`).join(" ") + " 32px";

  return (
    <li
      className="grid items-center gap-2 px-4 py-2.5"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setDetailTab("card");
            setDetailOpen(true);
          }}
          title={item.itemName}
          className="min-w-0 flex-1 truncate text-left text-sm text-neutral-800 dark:text-neutral-100 hover:text-blue-600 hover:underline"
          style={item.nameColor ? { color: item.nameColor } : undefined}
        >
          {item.itemName}
        </button>
        <button
          type="button"
          onClick={() => {
            setDetailTab("updates");
            setDetailOpen(true);
          }}
          className={`flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600 dark:hover:text-neutral-400 ${
            commentCount > 0 ? "text-blue-600" : "text-neutral-300 dark:text-neutral-600"
          }`}
          aria-label="留言"
        >
          <MessageSquare size={14} />
          {commentCount > 0 && <span>{commentCount}</span>}
        </button>
        {canManage && (
          <button
            type="button"
            onClick={() => setAssignOpen(true)}
            title={item.fullItem.assignments.map((a) => `${a.user.name} ${a.allocationPct}%`).join(", ")}
            className={`flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600 dark:hover:text-neutral-400 ${
              assignmentCount > 0 ? "text-blue-600" : "text-neutral-300 dark:text-neutral-600"
            }`}
            aria-label="指派"
          >
            <UserPlus size={14} />
            {assignmentCount > 0 && <span>{assignmentCount}</span>}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={() => setAddSubtaskOpen(true)}
            className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs text-neutral-300 dark:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600 dark:hover:text-neutral-400"
            aria-label="新增子任務"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {showAssignees && (
        <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {item.assignees
            .map((a) => (a.allocationPct !== null ? `${a.name} ${a.allocationPct}%` : a.name))
            .join(", ")}
        </span>
      )}

      <span className="truncate text-xs text-neutral-400 dark:text-neutral-500">{item.boardName}</span>

      <span className="truncate">
        {item.status ? (
          <span
            className="rounded-full px-2 py-0.5 text-xs text-white"
            style={{ backgroundColor: item.status.color }}
          >
            {item.status.label}
          </span>
        ) : (
          <span className="rounded-full bg-neutral-200 dark:bg-neutral-700 px-2 py-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            狀態未設置
          </span>
        )}
      </span>

      <span className="text-xs text-neutral-500 dark:text-neutral-400">
        {item.progressPct !== null && `${Math.round(item.progressPct * 100)}%`}
      </span>

      <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
        {item.dueDate &&
          `${item.startDate ? `${formatDate(item.startDate)} ~ ` : ""}${formatDate(item.dueDate)}`}
      </span>

      {canDelete && (
        <RowMenu>
          <RowMenuItem danger onSelect={() => requestDelete(item.boardId, item.itemId)}>
            <span className="flex items-center gap-2">
              <Trash2 size={14} /> 刪除
            </span>
          </RowMenuItem>
        </RowMenu>
      )}

      <ItemDetailModal
        boardId={item.boardId}
        item={detailOpen ? item.fullItem : null}
        columns={item.columns}
        users={users}
        progressColumnId={item.progressColumnId}
        ganttStartColumnId={item.ganttStartColumnId}
        ganttDurationColumnId={item.ganttDurationColumnId}
        ganttEndColumnId={item.ganttEndColumnId}
        predColumnId={item.predColumnId}
        linkColumnId={item.linkColumnId}
        groupItems={item.groupItems}
        lockedScheduleFields={
          item.scheduleLock ? new Map([[item.itemId, item.scheduleLock]]) : undefined
        }
        manualScheduleHint={item.scheduleHint}
        userRole={userRole}
        currentUserId={currentUserId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        initialTab={detailTab}
      />
      {canManage && (
        <AssignmentModal
          boardId={item.boardId}
          item={assignOpen ? item.fullItem : null}
          users={users}
          currentUserId={currentUserId}
          userRole={userRole}
          open={assignOpen}
          onOpenChange={setAssignOpen}
        />
      )}
      {canManage && (
        <AddSubtaskModal
          open={addSubtaskOpen}
          onOpenChange={setAddSubtaskOpen}
          parentItemId={item.itemId}
          parentItemName={item.itemName}
          parentStartDate={item.startDate}
          parentDueDate={item.dueDate}
          users={assignableUsers}
        />
      )}
    </li>
  );
}
