"use client";

import { useState } from "react";
import Link from "next/link";
import type { UserRole } from "@prisma/client";
import { loadItemDetailContext, type ItemDetailContext } from "@/lib/actions/itemSchedule";
import { ItemDetailModal } from "@/components/board/ItemDetailModal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { describeDeadline, formatDueShort, reminderLink, type DeadlineTone, type TodoDeadlineEntry } from "@/lib/todoDeadline";
import type { UserOption } from "@/types/board";
import { actionErrorMessage } from "@/lib/userError";

const TONE_CLASS: Record<DeadlineTone, string> = {
  overdue: "text-red-600",
  today: "text-orange-600",
  soon: "text-amber-600",
  later: "text-neutral-500 dark:text-neutral-400",
};

/**
 * 工作項目、風險 / 議題底下、有設期限而且還沒完成的待辦事項,依期限由近到遠排:
 * 「工作項目 - 待辦事項」加上期限日期與離今天還有幾天(逾期的標紅);風險 / 議題的前面標「風險」或「議題」。
 *
 * 跟旁邊的「待辦事項到期清單」不是同一個東西:那份列的是工作項目本身的結束日,
 * 這份列的是工作項目裡面、各個待辦事項自己的期限。點工作項目的一列直接跳出那個項目的「待辦事項」分頁;
 * 點風險 / 議題的一列跳到那一塊看板的風險分頁、開那一筆。
 */
export function TodoDeadlinesSection({
  entries,
  today,
  allUsers,
  currentUserId,
  userRole,
}: {
  entries: TodoDeadlineEntry[];
  /** 台北的今天("YYYY-MM-DD"),由伺服器給,跟提醒用同一個日期。 */
  today: string;
  allUsers: UserOption[];
  currentUserId: string;
  userRole: UserRole;
}) {
  const { notify } = useDialogs();
  const [itemDetail, setItemDetail] = useState<ItemDetailContext | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  async function open(itemId: string, todoId: string) {
    setOpeningId(todoId);
    try {
      const context = await loadItemDetailContext(itemId);
      if (!context) {
        await notify("找不到這個項目,或者沒有存取權限");
        return;
      }
      setItemDetail(context);
    } catch (err) {
      await notify(actionErrorMessage(err, "載入失敗"));
    } finally {
      setOpeningId(null);
    }
  }

  const overdueCount = entries.filter((e) => describeDeadline(today, e.dueDate).tone === "overdue").length;

  return (
    <section data-todo-deadlines>
      <h2 className="mb-3 flex flex-wrap items-baseline gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-100">
        待辦事項期限({entries.length})
        {overdueCount > 0 && <span className="text-xs font-normal text-red-600">其中 {overdueCount} 筆已逾期</span>}
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          工作項目、風險 / 議題底下還沒有設定期限的待辦事項(在「待辦事項」分頁可以替每一筆設定期限,到期前會提醒)
        </p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-neutral-100 overflow-auto rounded-md border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-700 dark:bg-neutral-900">
          {entries.map((entry) => {
            const due = describeDeadline(today, entry.dueDate);
            const rowClass = "flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-60 dark:hover:bg-neutral-800";
            const content = (
              <>
                <span className={`w-28 shrink-0 whitespace-nowrap text-xs tabular-nums ${TONE_CLASS[due.tone]}`}>
                  <span className="font-medium">{formatDueShort(entry.dueDate)}</span>・{due.text}
                </span>
                <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">
                  {entry.kind === "risk" && (
                    <span className="mr-1.5 rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {entry.riskKind === "ISSUE" ? "議題" : "風險"}
                    </span>
                  )}
                  {entry.itemName} - {entry.text}
                </span>
                <span className="hidden shrink-0 truncate text-xs text-neutral-400 dark:text-neutral-500 sm:block sm:max-w-[10rem]">
                  {entry.boardName}
                </span>
              </>
            );
            return (
              <li key={entry.todoId} data-todo-deadline-row={entry.todoId} data-todo-deadline-kind={entry.kind}>
                {entry.kind === "risk" && entry.riskId ? (
                  // 風險 / 議題的待辦事項:跳到那一塊看板的風險分頁、開那一筆(跟到期提醒的連結同一個地方)。
                  <Link href={reminderLink({ kind: "risk", boardId: entry.boardId, riskId: entry.riskId })} className={rowClass}>
                    {content}
                  </Link>
                ) : (
                  <button type="button" onClick={() => open(entry.itemId, entry.todoId)} disabled={openingId === entry.todoId} className={rowClass}>
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ItemDetailModal
        boardId={itemDetail?.boardId ?? ""}
        item={itemDetail?.item ?? null}
        columns={itemDetail?.columns ?? []}
        users={allUsers}
        progressColumnId={itemDetail?.progressColumnId ?? null}
        ganttStartColumnId={itemDetail?.ganttStartColumnId}
        ganttDurationColumnId={itemDetail?.ganttDurationColumnId}
        ganttEndColumnId={itemDetail?.ganttEndColumnId}
        predColumnId={itemDetail?.predColumnId}
        linkColumnId={itemDetail?.linkColumnId}
        groupItems={itemDetail?.groupItems}
        userRole={userRole}
        currentUserId={currentUserId}
        open={itemDetail !== null}
        onOpenChange={(open) => !open && setItemDetail(null)}
        initialTab="checklist"
      />
    </section>
  );
}
