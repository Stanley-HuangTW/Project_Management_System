"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, GripVertical, Plus, Trash2, X } from "lucide-react";
import {
  addTodoItem,
  deleteTodoItem,
  listTodoItems,
reorderTodoItems,
  setTodoAssignee,
  setTodoDueDate,
  setTodoInWeeklyReport,
  renameTodoItem,
  setTodoNote,
  toggleTodoItem,
} from "@/lib/actions/todo";
import { AssigneeSelect, reasonText, useAssignableUsers, useSuggestedAssignee } from "../AssigneeSelect";
import { TodoNote } from "../TodoNote";
import { TodoTitle } from "../TodoTitle";
import { useDialogs } from "@/components/ui/DialogProvider";
import { SortableList } from "@/components/ui/SortableList";
import { describeDeadline, formatDueShort, taipeiClock, type DeadlineTone } from "@/lib/todoDeadline";

const TONE_CLASS: Record<DeadlineTone, string> = {
  overdue: "text-red-600",
  today: "text-orange-600",
  soon: "text-amber-600",
  later: "text-neutral-500 dark:text-neutral-400",
};

export function ChecklistTab({ boardId, itemId }: { boardId: string; itemId: string }) {
  const [todos, setTodos] = useState<Awaited<ReturnType<typeof listTodoItems>>>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const { notify } = useDialogs();
  // 這個待辦事項的新增與完成要不要彙整進週報——預設要;新增之後下一個又回到預設。
  const [inWeekly, setInWeekly] = useState(true);
  // 新增時選填的期限;正在改期限的那一筆。
  const [dueText, setDueText] = useState("");
  const [editingDueId, setEditingDueId] = useState<string | null>(null);
  // 台北的今天——期限是台北的日曆日,「逾期」「明天到期」都跟它比。
  const today = taipeiClock(new Date()).date;
  // 處理者:新增時預設照規則帶入(@ 的人、負責人、人員分配 / 工時比例最高的人),可以改。
  const users = useAssignableUsers();
  const assignee = useSuggestedAssignee({ kind: "item", id: itemId }, text);

  async function refresh() {
    setTodos(await listTodoItems(itemId));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await listTodoItems(itemId);
        if (!cancelled) setTodos(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  async function handleAdd() {
    if (!text.trim()) return;
    const result = await addTodoItem(boardId, itemId, text.trim(), inWeekly, dueText || null, assignee.assigneeId || null);
    if (result.error) {
      await notify(result.error, { title: "無法新增" });
      return;
    }
    setText("");
    setInWeekly(true);
    setDueText("");
    assignee.reset();
    await refresh();
  }

  async function changeAssignee(todoId: string, next: string) {
    setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, assigneeId: next || null } : t)));
    const result = await setTodoAssignee(boardId, itemId, todoId, next || null);
    if (result.error) await notify(result.error, { title: "無法更改處理者" });
    await refresh();
  }

  async function changeDue(todoId: string, due: string | null) {
    setEditingDueId(null);
    const result = await setTodoDueDate(boardId, itemId, todoId, due);
    if (result.error) await notify(result.error, { title: "無法設定期限" });
    await refresh();
  }

  async function handleReorder(ids: string[]) {
    setTodos((prev) => ids.flatMap((id) => prev.find((t) => t.id === id) ?? []));
    const result = await reorderTodoItems(boardId, itemId, ids);
    if (result.error) await notify(result.error, { title: "無法調整順序" });
    await refresh();
  }

  async function changeTitle(todoId: string, next: string) {
    const result = await renameTodoItem(boardId, itemId, todoId, next);
    if (result.error) await notify(result.error, { title: "無法修改名稱" });
    await refresh();
  }

  async function changeNote(todoId: string, note: string | null) {
    const result = await setTodoNote(boardId, itemId, todoId, note);
    if (result.error) await notify(result.error, { title: "無法儲存備註" });
    await refresh();
  }

  async function handleToggle(todoId: string, done: boolean) {
    await toggleTodoItem(boardId, itemId, todoId, done);
    await refresh();
  }

  async function toggleWeekly(todoId: string, value: boolean) {
    setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, inWeeklyReport: value } : t)));
    const result = await setTodoInWeeklyReport(boardId, itemId, todoId, value);
    if (result.error) {
      await refresh();
      await notify(result.error, { title: "無法更改" });
    }
  }

  async function handleDelete(todoId: string) {
    await deleteTodoItem(boardId, itemId, todoId);
    await refresh();
  }

  const doneCount = todos.filter((t) => t.done).length;

  return (
    <div>
      {todos.length > 0 && (
        <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
          {doneCount} / {todos.length} 已完成
        </p>
      )}
      {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>}
      {!loading && todos.length === 0 && (
        <p className="mb-3 text-sm text-neutral-400 dark:text-neutral-500">尚無待辦事項</p>
      )}
      <div className="mb-4 space-y-1.5">
        <SortableList items={todos} handle onReorder={(ids) => void handleReorder(ids)}>
          {(t, handleProps) => (
          <div
            data-todo-row={t.id}
            className="group flex items-start gap-2 rounded px-1 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <button
              type="button"
              {...handleProps}
              data-todo-handle={t.id}
              title="拖曳調整順序"
              aria-label={`拖曳調整「${t.text}」的順序`}
              className="shrink-0 cursor-grab touch-none rounded p-0.5 text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-300"
            >
              <GripVertical size={14} />
            </button>
            <input
              type="checkbox"
              checked={t.done}
              onChange={(e) => handleToggle(t.id, e.target.checked)}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <TodoTitle todoId={t.id} value={t.text} done={t.done} onSave={(next) => changeTitle(t.id, next)} />
              <TodoNote todoId={t.id} value={t.note} onSave={(note) => changeNote(t.id, note)} />
            </div>
            <AssigneeSelect value={t.assigneeId ?? ""} users={users} onChange={(v) => void changeAssignee(t.id, v)} data-todo-assignee={t.id} />
            {editingDueId === t.id ? (
              <span className="flex shrink-0 items-center gap-1">
                <input
                  type="date"
                  autoFocus
                  defaultValue={t.dueDate ?? ""}
                  data-todo-due-input={t.id}
                  onChange={(e) => e.target.value && changeDue(t.id, e.target.value)}
                  onBlur={() => setEditingDueId(null)}
                  className="rounded border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                />
                {t.dueDate && (
                  <button
                    type="button"
                    // onMouseDown:輸入框的 onBlur 會先把編輯狀態收掉,click 就來不及了。
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void changeDue(t.id, null);
                    }}
                    className="text-neutral-400 hover:text-red-600"
                    aria-label="清除期限"
                    title="清除期限"
                  >
                    <X size={13} />
                  </button>
                )}
              </span>
            ) : t.dueDate ? (
              <button
                type="button"
                onClick={() => setEditingDueId(t.id)}
                data-todo-due={t.id}
                title={`期限 ${t.dueDate}(點一下修改)`}
                className={`shrink-0 whitespace-nowrap rounded px-1 text-xs tabular-nums hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                  t.done ? "text-neutral-400 dark:text-neutral-500" : TONE_CLASS[describeDeadline(today, t.dueDate).tone]
                }`}
              >
                {formatDueShort(t.dueDate)}
                {!t.done && `・${describeDeadline(today, t.dueDate).text}`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEditingDueId(t.id)}
                data-todo-set-due={t.id}
                className="shrink-0 text-neutral-300 dark:text-neutral-600 opacity-0 hover:text-blue-600 group-hover:opacity-100"
                aria-label="設定期限"
                title="設定期限(到期前一天、當天、逾期會提醒)"
              >
                <CalendarPlus size={14} />
              </button>
            )}
            <label
                className={`flex shrink-0 items-center gap-1 text-[11px] ${false ? "text-neutral-300 dark:text-neutral-600" : "cursor-pointer text-neutral-500 dark:text-neutral-400"}`}
                title={false ? "只有寫這一筆的人、主管與管理者可以改" : "勾選:這一筆的資訊會彙整進週報"}
              >
                <input type="checkbox" checked={t.inWeeklyReport} disabled={false} onChange={(e) => toggleWeekly(t.id, e.target.checked)} className="h-3 w-3 accent-blue-600" />
                週報
              </label>
            <button
              type="button"
              onClick={() => handleDelete(t.id)}
              className="shrink-0 text-neutral-300 dark:text-neutral-600 opacity-0 hover:text-red-600 group-hover:opacity-100"
              aria-label="刪除"
            >
              <Trash2 size={14} />
            </button>
          </div>
          )}
        </SortableList>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="+ 新增待辦事項"
          className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        />
        <label
          className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300"
          title="選填:到期前一天、當天、逾期會提醒這個工作項目的負責人與新增的人"
        >
          期限
          <input
            type="date"
            value={dueText}
            onChange={(e) => setDueText(e.target.value)}
            data-new-todo-due
            className="rounded border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1 py-0.5 text-xs outline-none focus:border-blue-500"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300" title={reasonText(assignee.reason) ?? "處理者:這個待辦事項由誰完成"}>
          處理者
          <AssigneeSelect value={assignee.assigneeId} users={users} onChange={assignee.choose} data-new-todo-assignee="" />
        </label>
        <label
          className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300"
          title="勾選:這個待辦事項的新增與完成會彙整進週報(預設勾選)"
        >
          <input
            type="checkbox"
            checked={inWeekly}
            onChange={(e) => setInWeekly(e.target.checked)}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          更新至週報
        </label>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!text.trim()}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus size={14} /> 新增
        </button>
      </div>
    </div>
  );
}
