"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { ColumnData, ItemData, UserOption, PredOption } from "@/types/board";
import type { ScheduleLock } from "@/lib/predecessorLink";
import type { PredLamp } from "@/lib/predLamp";
import type { ScheduleFloat } from "@/lib/criticalPath";
import type { UserRole } from "@prisma/client";
import { UpdatesTab } from "./item-detail/UpdatesTab";
import { FilesTab } from "./item-detail/FilesTab";
import { LinksTab } from "./item-detail/LinksTab";
import { ActivityLogTab } from "./item-detail/ActivityLogTab";
import { ItemCardTab } from "./item-detail/ItemCardTab";
import { ChecklistTab } from "./item-detail/ChecklistTab";
import { CostTab } from "./item-detail/CostTab";

const TABS = [
  { id: "updates", label: "更新" },
  { id: "files", label: "檔案" },
  { id: "links", label: "連結" },
  { id: "activity", label: "活動紀錄" },
  { id: "card", label: "項目卡片" },
  { id: "checklist", label: "待辦事項" },
  { id: "cost", label: "工時與費用" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ItemDetailModal({
  boardId,
  item,
  columns,
  users,
  progressColumnId,
  ganttStartColumnId,
  ganttDurationColumnId,
  ganttEndColumnId,
  predColumnId,
  linkColumnId,
  predLamp,
  scheduleFloat,
  groupItems,
  crossGroupPredOptions,
  lockedScheduleFields,
  manualScheduleHint,
  userRole,
  currentUserId,
  open,
  onOpenChange,
  initialTab = "updates",
}: {
  boardId: string;
  item: ItemData | null;
  columns: ColumnData[];
  users: UserOption[];
  progressColumnId: string | null;
  ganttStartColumnId?: string | null;
  ganttDurationColumnId?: string | null;
  ganttEndColumnId?: string | null;
  /** Pred's dropdown needs every other item in the same group — see
   *  CellEditor's predColumnId/groupItems. */
  predColumnId?: string | null;
  /** For the 相關項目 list's Link labels — see listDependentItems. */
  linkColumnId?: string | null;
  /** What this item's predecessor's state means for it — see resolvePredLamp. */
  predLamp?: PredLamp | null;
  /** Total float from the CPM backward pass — see computeCriticalPath. */
  scheduleFloat?: ScheduleFloat;
  groupItems?: ItemData[];
  /** 這個分組以外的可選前置(含同群組其他看板的)。 */
  crossGroupPredOptions?: PredOption[];
  lockedScheduleFields?: Map<string, ScheduleLock>;
  /** What to tell the user to edit instead when a Start/Days/Finish field
   *  is locked — see manualScheduleHint in @/lib/gantt. */
  manualScheduleHint?: string;
  userRole: UserRole;
  currentUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: TabId;
}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  // Reset to initialTab each time the modal transitions open, without
  // fighting manual tab switches while it's already open — the "adjust
  // state during render" pattern, not an effect (avoids an extra render).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setTab(initialTab);
  }

  if (!item) return null;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={item.name} size="xl">
      <div className="mb-4 flex gap-1 border-b border-neutral-200 dark:border-neutral-700">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm ${
              tab === t.id
                ? "border-b-2 border-blue-600 font-medium text-blue-600"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "updates" && <UpdatesTab boardId={boardId} itemId={item.id} users={users} />}
      {tab === "cost" && (
        <CostTab
          itemId={item.id}
          users={users}
          currentUserId={currentUserId}
          userRole={userRole}
          budgetCost={item.budgetCost}
          actualCost={item.actualCost}
          canEdit={userRole !== "MEMBER"}
        />
      )}
      {tab === "files" && <FilesTab boardId={boardId} itemId={item.id} />}
      {tab === "links" && <LinksTab boardId={boardId} itemId={item.id} />}
      {tab === "activity" && <ActivityLogTab itemId={item.id} />}
      {tab === "card" && (
        <ItemCardTab
          boardId={boardId}
          item={item}
          columns={columns}
          users={users}
          progressColumnId={progressColumnId}
          ganttStartColumnId={ganttStartColumnId ?? null}
          ganttDurationColumnId={ganttDurationColumnId ?? null}
          ganttEndColumnId={ganttEndColumnId ?? null}
          predColumnId={predColumnId}
          linkColumnId={linkColumnId}
          predLamp={predLamp}
          scheduleFloat={scheduleFloat}
          groupItems={groupItems}
          crossGroupPredOptions={crossGroupPredOptions}
          lockedScheduleFields={lockedScheduleFields}
          manualScheduleHint={manualScheduleHint}
          userRole={userRole}
          currentUserId={currentUserId}
        />
      )}
      {tab === "checklist" && <ChecklistTab boardId={boardId} itemId={item.id} />}
    </Modal>
  );
}
