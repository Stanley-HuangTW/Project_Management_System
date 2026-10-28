"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { addTodoItem } from "@/lib/actions/todo";
import { addRiskTodo } from "@/lib/actions/riskTodo";
import { createComment } from "@/lib/actions/comment";
import { addRiskUpdate } from "@/lib/actions/risk";
import { isValidDueDate } from "@/lib/todoDeadline";
import type { ChatMessageDto } from "@/lib/chatTypes";
import { AssigneeSelect, reasonText, useAssignableUsers, useSuggestedAssignee } from "@/components/board/AssigneeSelect";
import { BoardRefPicker, REF_KIND_LABELS, type BoardRef, type RefKind } from "./BoardRefPicker";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

/** 轉換的目標可以是這四類(議題 = Mantis 同步來的);待辦事項與留言兩種都能加在任何一類上。 */
const KINDS: RefKind[] = ["item", "risk", "issue", "mantis"];

/**
 * 把對話裡的一則訊息變成某個項目底下的待辦事項或留言——討論出結論的時候,
 * 不用複製貼上、也不用記得是哪個項目。文字可以先改。
 * 目標是這間對話所屬看板的工作項、風險、問題或議題(私訊、聊天室沒有看板,先挑看板),
 * 直接從清單挑(工作項是可以收放的階層,上面有搜尋)。待辦事項與留言在四類上都能加,畫面一樣,
 * 差別只在待辦事項多了**期限**與**處理者**:處理者預設是訊息裡 @ 的人(即使項目已經有負責人),
 * 沒有 @ 就是項目的負責人;工作項沒有負責人就取人員分配 / 工時比例最高的人。可以改。
 * 風險、問題、議題的留言叫「進度更新」。
 * 寫入走原本的 addTodoItem / addRiskTodo / createComment / addRiskUpdate,權限、活動紀錄、通知都跟手動新增一樣。
 */
export function ConvertMessageDialog({
  message,
  mode,
  boardId,
  onClose,
}: {
  message: ChatMessageDto;
  mode: "todo" | "comment";
  /** 這間對話所屬的看板(看板頻道才有);清單就列這個看板的。 */
  boardId: string | null;
  onClose: () => void;
}) {
  const { notify } = useDialogs();
  const [text, setText] = useState(message.body);
  const [picked, setPicked] = useState<BoardRef | null>(null);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const users = useAssignableUsers();
  const assignee = useSuggestedAssignee(picked && mode === "todo" ? { kind: picked.kind === "item" ? "item" : "risk", id: picked.id } : null, text);

  const label = mode === "todo" ? "待辦事項" : "留言";
  /** 風險、問題、議題的留言叫「進度更新」。 */
  const targetLabel = mode === "comment" && picked && picked.kind !== "item" ? "進度更新" : label;

  async function submit() {
    if (!picked || !text.trim() || busy) return;
    if (mode === "todo" && due && !isValidDueDate(due)) {
      await notify("期限的日期格式不正確");
      return;
    }
    setBusy(true);
    try {
      let error: string | undefined;
      const handler = assignee.assigneeId || null;
      if (mode === "todo") {
        error =
          picked.kind === "item"
            ? (await addTodoItem(picked.boardId, picked.id, text, true, due || null, handler)).error
            : (await addRiskTodo(picked.id, text, due || null, handler)).error;
      } else if (picked.kind === "item") {
        await createComment(picked.boardId, picked.id, text);
      } else {
        error = (await addRiskUpdate(picked.id, text)).error;
      }
      if (error) {
        await notify(error);
        return;
      }
      // 先關掉轉換視窗再提示,不讓人還要多按一下才回得到對話。
      onClose();
      void notify(`已加到「${picked.name}」的${targetLabel}`, { title: "完成" });
    } catch {
      await notify(`沒有成功。請確認你有「${picked.boardName}」這個看板的權限。`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={`轉成${label}`}>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block text-neutral-600 dark:text-neutral-300">{label}內容</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={`${inputClass} resize-y`} data-convert-text />
        </label>

        <div>
          <span className="mb-1 block text-neutral-600 dark:text-neutral-300">加到哪個項目(工作項、風險、問題或議題)</span>
          {picked ? (
            <div className="flex items-center justify-between rounded-md border border-blue-300 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-950">
              <span className="min-w-0 truncate" data-convert-picked>
                <span className="text-neutral-500 dark:text-neutral-400">{picked.boardName} › </span>
                {picked.kind !== "item" && (
                  <span className="mr-1 rounded bg-neutral-200 px-1 text-[11px] text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200">
                    {REF_KIND_LABELS[picked.kind]}
                  </span>
                )}
                {picked.name}
              </span>
              <button type="button" className="ml-2 shrink-0 text-xs text-blue-600" onClick={() => setPicked(null)}>
                重選
              </button>
            </div>
          ) : (
            <BoardRefPicker boardId={boardId} kinds={KINDS} onPick={setPicked} />
          )}
        </div>

        {mode === "todo" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-neutral-600 dark:text-neutral-300">期限(選填)</span>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} data-convert-due />
            </label>
            <label className="block">
              <span className="mb-1 block text-neutral-600 dark:text-neutral-300">處理者</span>
              <AssigneeSelect
                value={assignee.assigneeId}
                users={users}
                onChange={assignee.choose}
                className="w-full !px-3 !py-1.5 !text-sm"
                data-convert-assignee=""
              />
              <span className="mt-1 block text-[11px] text-neutral-400 dark:text-neutral-500" data-convert-assignee-reason>
                {picked ? (reasonText(assignee.reason) ?? (assignee.assigneeId ? "" : "這個項目沒有負責人,可以自己挑")) : "挑好項目後帶入預設"}
              </span>
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!picked || !text.trim() || busy}
            data-convert-submit
            className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "處理中…" : `加成${targetLabel}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
