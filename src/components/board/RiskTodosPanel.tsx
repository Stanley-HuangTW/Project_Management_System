"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, Plus, Trash2, X } from "lucide-react";
import {
  addRiskTodo,
  deleteRiskTodo,
  listRiskTodos,
  setRiskTodoAssignee,
  setRiskTodoDueDate,
  setRiskTodoNote,
  toggleRiskTodo,
  type RiskTodoRow,
} from "@/lib/actions/riskTodo";
import { AssigneeSelect, reasonText, useAssignableUsers, useSuggestedAssignee } from "./AssigneeSelect";
import { TodoNote } from "./TodoNote";
import { useDialogs } from "@/components/ui/DialogProvider";
import { describeDeadline, formatDueShort, taipeiClock, type DeadlineTone } from "@/lib/todoDeadline";

const TONE_CLASS: Record<DeadlineTone, string> = {
  overdue: "text-red-600",
  today: "text-orange-600",
  soon: "text-amber-600",
  later: "text-neutral-500 dark:text-neutral-400",
};

/**
 * 風險 / 議題的「待辦事項」:跟工作項的待辦事項(ChecklistTab)同一個樣子——勾完成、可以設期限,
 * 到期前一天、當天、逾期後各提醒一次。對話裡的訊息也可以直接轉成這裡的待辦事項。
 */
export function RiskTodosPanel({ riskId }: { riskId: string }) {
  const [todos, setTodos] = useState<RiskTodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [dueText, setDueText] = useState("");
  const [editingDueId, setEditingDueId] = useState<string | null>(null);
  const { notify } = useDialogs();
  // 台北的今天——期限是台北的日曆日,「逾期」「明天到期」都跟它比。
  const today = taipeiClock(new Date()).date;
  // 處理者:新增時預設是這一筆的負責人(文字裡 @ 了誰就是誰),可以改。
  const users = useAssignableUsers();
  const assignee = useSuggestedAssignee({ kind: "risk", id: riskId }, text);

  async function refresh() {
    setTodos(await listRiskTodos(riskId));
  }

  useEffect(() => {
    let cancelled = false;
    void listRiskTodos(riskId).then((rows) => {
      if (cancelled) return;
      setTodos(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [riskId]);

  async function handleAdd() {
    if (!text.trim()) return;
    const result = await addRiskTodo(riskId, text, dueText || null, assignee.assigneeId || null);
    if (result.error) {
      await notify(result.error, { title: "無法新增" });
      return;
    }
    setText("");
    setDueText("");
    assignee.reset();
    await refresh();
  }

  async function changeAssignee(todoId: string, next: string) {
    setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, assigneeId: next || null } : t)));
    const result = await setRiskTodoAssignee(todoId, next || null);
    if (result.error) await notify(result.error, { title: "無法更改處理者" });
    await refresh();
  }

  async function changeDue(todoId: string, due: string | null) {
    setEditingDueId(null);
    const result = await setRiskTodoDueDate(todoId, due);
    if (result.error) await notify(result.error, { title: "無法設定期限" });
    await refresh();
  }

  async function changeNote(todoId: string, note: string | null) {
    const result = await setRiskTodoNote(todoId, note);
    if (result.error) await notify(result.error, { title: "無法儲存備註" });
    await refresh();
  }

  async function handleToggle(todoId: string, done: boolean) {
    const result = await toggleRiskTodo(todoId, done);
    if (result.error) await notify(result.error, { title: "無法更改" });
    await refresh();
  }

  async function handleDelete(todoId: string) {
    const result = await deleteRiskTodo(todoId);
    if (result.error) await notify(result.error, { title: "無法刪除" });
    await refresh();
  }

  const doneCount = todos.filter((t) => t.done).length;

  return (
    <div data-risk-todos>
      {todos.length > 0 && (
        <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
          {doneCount} / {todos.length} 已完成
        </p>
      )}
      {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>}
      {!loading && todos.length === 0 && <p className="mb-3 text-sm text-neutral-400 dark:text-neutral-500">尚無待辦事項</p>}
      <ul className="mb-4 space-y-1.5">
        {todos.map((t) => (
          <li key={t.id} data-risk-todo={t.id} className="group flex items-start gap-2 rounded px-1 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800">
            <input type="checkbox" checked={t.done} onChange={(e) => void handleToggle(t.id, e.target.checked)} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <span
                className={`block text-sm ${
                  t.done ? "text-neutral-400 dark:text-neutral-500 line-through" : "text-neutral-800 dark:text-neutral-100"
                }`}
              >
                {t.text}
              </span>
              <TodoNote todoId={t.id} value={t.note} onSave={(note) => changeNote(t.id, note)} />
            </div>
            <AssigneeSelect value={t.assigneeId ?? ""} users={users} onChange={(v) => void changeAssignee(t.id, v)} data-todo-assignee={t.id} />
            {editingDueId === t.id ? (
              <span className="flex shrink-0 items-center gap-1">
                <input
                  type="date"
                  autoFocus
                  defaultValue={t.dueDate ?? ""}
                  onChange={(e) => e.target.value && void changeDue(t.id, e.target.value)}
                  onBlur={() => setEditingDueId(null)}
                  className="rounded border border-neutral-300 px-1 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
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
                className="shrink-0 text-neutral-300 opacity-0 hover:text-blue-600 group-hover:opacity-100 dark:text-neutral-600"
                aria-label="設定期限"
                title="設定期限(到期前一天、當天、逾期會提醒)"
              >
                <CalendarPlus size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleDelete(t.id)}
              className="shrink-0 text-neutral-300 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-neutral-600"
              aria-label="刪除"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
          placeholder="+ 新增待辦事項"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
        />
        <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300" title="選填:到期前一天、當天、逾期會提醒這一筆的負責人與新增的人">
          期限
          <input
            type="date"
            value={dueText}
            onChange={(e) => setDueText(e.target.value)}
            className="rounded border border-neutral-300 px-1 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300" title={reasonText(assignee.reason) ?? "處理者:這個待辦事項由誰完成"}>
          處理者
          <AssigneeSelect value={assignee.assigneeId} users={users} onChange={assignee.choose} data-new-todo-assignee="" />
        </label>
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={!text.trim()}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus size={14} /> 新增
        </button>
      </div>
    </div>
  );
}
