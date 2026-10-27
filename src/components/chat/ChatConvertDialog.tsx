"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { searchChatItems } from "@/lib/actions/chat";
import { addTodoItem } from "@/lib/actions/todo";
import { createComment } from "@/lib/actions/comment";
import { addRiskUpdate } from "@/lib/actions/risk";
import { isValidDueDate } from "@/lib/todoDeadline";
import type { ChatItemHit, ChatMessageDto } from "@/lib/chatTypes";
import { BoardRefPicker, REF_KIND_LABELS, type BoardRef, type RefKind } from "./BoardRefPicker";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

/**
 * 把對話裡的一則訊息變成某個項目底下的待辦事項或留言——討論出結論的時候,
 * 不用複製貼上、也不用記得是哪個項目。文字可以先改;待辦事項還可以順便設期限。
 * 挑項目有兩種方式:輸入名稱搜尋,或從清單選——清單是這間對話所屬看板的工作項、風險、問題
 * (私訊、聊天室沒有看板,先挑看板)。待辦事項只能加在工作項上;留言可以加在工作項,
 * 也可以加在風險或問題(變成它的進度更新)。
 * 寫入走原本的 addTodoItem / createComment / addRiskUpdate,權限、活動紀錄、通知都跟手動新增一樣。
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
  const [how, setHow] = useState<"search" | "list">("search");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ChatItemHit[]>([]);
  const [picked, setPicked] = useState<BoardRef | null>(null);
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
  const kinds: RefKind[] = mode === "todo" ? ["item"] : ["item", "risk", "issue"];
  /** 風險、問題的留言叫「進度更新」。 */
  const targetLabel = picked && picked.kind !== "item" ? "進度更新" : label;

  async function submit() {
    if (!picked || !text.trim() || busy) return;
    if (mode === "todo" && due && !isValidDueDate(due)) {
      await notify("期限的日期格式不正確");
      return;
    }
    setBusy(true);
    try {
      let error: string | undefined;
      if (picked.kind !== "item") {
        error = (await addRiskUpdate(picked.id, text)).error;
      } else if (mode === "todo") {
        error = (await addTodoItem(picked.boardId, picked.id, text, true, due || null)).error;
      } else {
        await createComment(picked.boardId, picked.id, text);
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
          <span className="mb-1 block text-neutral-600 dark:text-neutral-300">
            {mode === "todo" ? "加到哪個工作項" : "加到哪個項目(工作項、風險或問題)"}
          </span>
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
            <>
              <div className="mb-2 flex gap-1" role="tablist">
                {(
                  [
                    ["search", "搜尋工作項"],
                    ["list", "從清單選"],
                  ] as const
                ).map(([key, name]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={how === key}
                    data-convert-how={key}
                    onClick={() => setHow(key)}
                    className={`rounded-md px-2.5 py-1 text-xs ${
                      how === key
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                        : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {how === "search" ? (
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
                            onClick={() => setPicked({ kind: "item", id: hit.itemId, boardId: hit.boardId, boardName: hit.boardName, name: hit.name })}
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
              ) : (
                <BoardRefPicker boardId={boardId} kinds={kinds} onPick={setPicked} />
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
            {busy ? "處理中…" : `加成${targetLabel}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
