"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { searchChatItems } from "@/lib/actions/chat";
import { addTodoItem } from "@/lib/actions/todo";
import { createComment } from "@/lib/actions/comment";
import { isValidDueDate } from "@/lib/todoDeadline";
import type { ChatItemHit, ChatMessageDto } from "@/lib/chatTypes";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

/**
 * 把對話裡的一則訊息變成某個工作項底下的待辦事項或留言——討論出結論的時候,
 * 不用複製貼上、也不用記得是哪個項目。文字可以先改;待辦事項還可以順便設期限。
 * 寫入走原本的 addTodoItem / createComment,權限、活動紀錄、通知都跟手動新增一樣。
 */
export function ConvertMessageDialog({ message, mode, onClose }: { message: ChatMessageDto; mode: "todo" | "comment"; onClose: () => void }) {
  const { notify } = useDialogs();
  const [text, setText] = useState(message.body);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ChatItemHit[]>([]);
  const [picked, setPicked] = useState<ChatItemHit | null>(null);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const found = await searchChatItems(q);
      if (!stale) setHits(found);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const label = mode === "todo" ? "待辦事項" : "留言";

  async function submit() {
    if (!picked || !text.trim() || busy) return;
    if (mode === "todo" && due && !isValidDueDate(due)) {
      await notify("期限的日期格式不正確");
      return;
    }
    setBusy(true);
    try {
      if (mode === "todo") {
        const result = await addTodoItem(picked.boardId, picked.itemId, text, true, due || null);
        if (result.error) {
          await notify(result.error);
          return;
        }
      } else {
        await createComment(picked.boardId, picked.itemId, text);
      }
      // 先關掉轉換視窗再提示,不讓人還要多按一下才回得到對話。
      onClose();
      void notify(`已加到「${picked.name}」的${label}`, { title: "完成" });
    } catch {
      await notify(`沒有成功。請確認你有「${picked.boardName}」這個看板的權限。`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={`轉成工作項的${label}`}>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block text-neutral-600 dark:text-neutral-300">{label}內容</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={`${inputClass} resize-y`} data-convert-text />
        </label>

        <div>
          <span className="mb-1 block text-neutral-600 dark:text-neutral-300">加到哪個工作項</span>
          {picked ? (
            <div className="flex items-center justify-between rounded-md border border-blue-300 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-950">
              <span className="min-w-0 truncate">
                <span className="text-neutral-500 dark:text-neutral-400">{picked.boardName} › </span>
                {picked.name}
              </span>
              <button type="button" className="ml-2 shrink-0 text-xs text-blue-600" onClick={() => setPicked(null)}>
                重選
              </button>
            </div>
          ) : (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="輸入工作項名稱搜尋…"
                autoFocus
                data-convert-search
                className={inputClass}
              />
              {query.trim() && (
                <ul className="mt-1 max-h-44 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700">
                  {hits.length === 0 && <li className="px-3 py-2 text-neutral-400">找不到符合的工作項</li>}
                  {hits.map((hit) => (
                    <li key={hit.itemId}>
                      <button
                        type="button"
                        onClick={() => setPicked(hit)}
                        data-convert-hit
                        className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
                      >
                        <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">{hit.name}</span>
                        <span className="shrink-0 text-xs text-neutral-400">{hit.boardName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {mode === "todo" && (
          <label className="block">
            <span className="mb-1 block text-neutral-600 dark:text-neutral-300">期限(選填)</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} />
          </label>
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
            {busy ? "處理中…" : `加成${label}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
