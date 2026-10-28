"use client";

import { useState } from "react";
import { TODO_TEXT_MAX } from "@/lib/todoNote";

/**
 * 待辦事項的名稱:點一下就能改,離開輸入框或按 Enter 存檔(沒改或清空就放棄,名稱不能留空)。
 * 工作項與風險 / 議題的待辦事項共用;存檔失敗的提示由 onSave 自己負責。
 * 不做 Esc 放棄:在視窗裡按 Esc 會關掉整個視窗。
 */
export function TodoTitle({ todoId, value, done, onSave }: { todoId: string; value: string; done: boolean; onSave: (text: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function start() {
    setDraft(value);
    setEditing(true);
  }

  async function finish() {
    setEditing(false);
    const next = draft.replace(/\s*[\r\n]+\s*/g, " ").trim();
    if (!next || next === value) return;
    await onSave(next);
  }

  if (editing) {
    return (
      <textarea
        autoFocus
        rows={Math.min(4, Math.max(1, Math.ceil(draft.length / 40)))}
        value={draft}
        maxLength={TODO_TEXT_MAX}
        data-todo-title-input={todoId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void finish()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className="block w-full resize-none rounded border border-neutral-300 px-1.5 py-0.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={start}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          start();
        }
      }}
      data-todo-title={todoId}
      title="點一下修改名稱"
      className={`block cursor-text rounded text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
        done ? "text-neutral-400 dark:text-neutral-500 line-through" : "text-neutral-800 dark:text-neutral-100"
      }`}
    >
      {value}
    </span>
  );
}
