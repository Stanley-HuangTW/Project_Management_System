"use client";

import { useState } from "react";
import { TODO_NOTE_MAX } from "@/lib/todoNote";

/**
 * 待辦事項下面的「備註」:記錄處理的狀態、結果。點一下就能改,離開輸入框或按 Ctrl+Enter 存檔。
 * 工作項與風險 / 議題的待辦事項共用;存檔失敗的提示由 onSave 自己負責。
 */
export function TodoNote({ todoId, value, onSave }: { todoId: string; value: string | null; onSave: (note: string | null) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function start() {
    setDraft(value ?? "");
    setEditing(true);
  }

  async function finish() {
    setEditing(false);
    if (draft.trim() === (value ?? "")) return;
    await onSave(draft);
  }

  if (editing) {
    return (
      <textarea
        autoFocus
        rows={2}
        value={draft}
        maxLength={TODO_NOTE_MAX}
        data-todo-note-input={todoId}
        placeholder="備註:記錄目前的狀態、處理結果(Ctrl+Enter 或點別處儲存)"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void finish()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.blur();
        }}
        className="mt-0.5 w-full resize-y rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
      />
    );
  }

  return value ? (
    <button
      type="button"
      onClick={start}
      data-todo-note={todoId}
      title="點一下修改備註"
      className="mt-0.5 block w-full whitespace-pre-wrap break-words rounded bg-neutral-50 px-2 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
    >
      {value}
    </button>
  ) : (
    <button
      type="button"
      onClick={start}
      data-todo-note-add={todoId}
      className="mt-0.5 block text-[11px] text-neutral-300 hover:text-blue-600 dark:text-neutral-600"
    >
      + 備註
    </button>
  );
}
