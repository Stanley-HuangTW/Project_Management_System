"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ItemData } from "@/types/board";
import type { UserRole } from "@prisma/client";
import { KanbanCard } from "./KanbanCard";

// Same four due-time windows as the dashboard's due list and the "到期時間"
// grouping mode, plus a fifth catch-all — shown as a small divider between
// cards whenever a lane's sort order crosses into the next bucket.
const BUCKET_LABELS = ["已逾期", "本週完成", "未來 7 天", "未來 30 天", "其他"];
const BUCKET_TEXT_CLASSES = [
  "text-red-600 dark:text-red-400",
  "text-green-600 dark:text-green-400",
  "text-blue-600 dark:text-blue-400",
  "text-neutral-500 dark:text-neutral-400",
  "text-neutral-400 dark:text-neutral-500",
];

export function KanbanLane({
  laneId,
  label,
  color,
  items,
  userRole,
  currentUserId,
  personColumnIds,
  wbsByItemId,
  bucketByItemId,
  openingItemId,
  onOpenDetail,
}: {
  laneId: string;
  label: string;
  color: string;
  items: ItemData[];
  userRole: UserRole;
  currentUserId: string;
  personColumnIds: string[];
  wbsByItemId: Map<string, string>;
  bucketByItemId: Map<string, number>;
  openingItemId: string | null;
  onOpenDetail: (itemId: string) => void;
}) {
  const { setNodeRef } = useDroppable({ id: laneId, data: { type: "lane" } });

  const rows: { item: ItemData; bucket: number; showDivider: boolean }[] = [];
  let lastBucket = -1;
  for (const item of items) {
    const bucket = bucketByItemId.get(item.id) ?? BUCKET_LABELS.length - 1;
    rows.push({ item, bucket, showDivider: bucket !== lastBucket });
    lastBucket = bucket;
  }

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-neutral-100 dark:bg-neutral-800">
      <div
        className="flex items-center gap-2 rounded-t-lg px-3 py-2 text-sm font-medium text-white"
        style={{ backgroundColor: color }}
      >
        {label}
        <span className="ml-auto text-xs opacity-80">{items.length}</span>
      </div>
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="flex min-h-[60px] flex-col gap-2 p-2">
          {rows.map(({ item, bucket, showDivider }) => (
            <div key={item.id}>
              {showDivider && (
                <p className={`mb-1 px-1 text-[11px] font-medium ${BUCKET_TEXT_CLASSES[bucket]}`}>
                  {BUCKET_LABELS[bucket]}
                </p>
              )}
              <KanbanCard
                item={item}
                userRole={userRole}
                currentUserId={currentUserId}
                personColumnIds={personColumnIds}
                wbsCode={wbsByItemId.get(item.id) ?? ""}
                isOpening={openingItemId === item.id}
                onOpenDetail={onOpenDetail}
              />
            </div>
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
