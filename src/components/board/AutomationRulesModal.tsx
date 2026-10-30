"use client";

import { UserSelect } from "@/components/ui/UserSelect";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { ColumnData, GroupData, UserOption } from "@/types/board";
import { getStatusOptions } from "@/types/column";
import {
  listRules,
  createRule,
  deleteRule,
  toggleRule,
} from "@/lib/actions/automation";
import { actionErrorMessage } from "@/lib/userError";

type RuleData = Awaited<ReturnType<typeof listRules>>[number];

export function AutomationRulesModal({
  boardId,
  columns,
  groups,
  users,
  open,
  onOpenChange,
}: {
  boardId: string;
  columns: ColumnData[];
  groups: GroupData[];
  users: UserOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const statusColumns = columns.filter((c) => c.type === "STATUS");
  const settableColumns = columns.filter((c) =>
    ["STATUS", "TEXT", "NUMBER"].includes(c.type)
  );

  const [rules, setRules] = useState<RuleData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [triggerColumnId, setTriggerColumnId] = useState(statusColumns[0]?.id ?? "");
  const [triggerValue, setTriggerValue] = useState(
    statusColumns[0] ? getStatusOptions(statusColumns[0].options)[0]?.id ?? "" : ""
  );
  const [notifyUserId, setNotifyUserId] = useState("");
  const [setColumnId, setSetColumnId] = useState("");
  const [setValue, setSetValue] = useState("");
  const [moveToGroupId, setMoveToGroupId] = useState("");

  const triggerColumn = columns.find((c) => c.id === triggerColumnId);
  const triggerOptions = triggerColumn ? getStatusOptions(triggerColumn.options) : [];
  const setColumn = columns.find((c) => c.id === setColumnId);
  const setColumnOptions = setColumn?.type === "STATUS" ? getStatusOptions(setColumn.options) : [];

  function load() {
    setLoading(true);
    listRules(boardId)
      .then(setRules)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await listRules(boardId);
        if (!cancelled) setRules(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function handleCreate() {
    if (!name.trim() || !triggerColumnId || !triggerValue) return;
    setSubmitting(true);
    setError(null);
    try {
      await createRule(boardId, name.trim(), triggerColumnId, triggerValue, {
        notifyUserId: notifyUserId || null,
        setColumnId: setColumnId || null,
        setValue: setColumnId
          ? setColumn?.type === "NUMBER"
            ? setValue === "" ? null : Number(setValue)
            : setValue || null
          : null,
        moveToGroupId: moveToGroupId || null,
      });
      setName("");
      setNotifyUserId("");
      setSetColumnId("");
      setSetValue("");
      setMoveToGroupId("");
      load();
    } catch (err) {
      setError(actionErrorMessage(err, "建立失敗"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(ruleId: string) {
    await deleteRule(ruleId, boardId);
    load();
  }

  async function handleToggle(ruleId: string, enabled: boolean) {
    await toggleRule(ruleId, boardId, enabled);
    load();
  }

  function statusLabel(column: ColumnData | undefined, id: string) {
    if (!column) return id;
    return getStatusOptions(column.options).find((o) => o.id === id)?.label ?? id;
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="自動化規則" size="lg">
      {error && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-4 max-h-64 space-y-2 overflow-auto">
        {loading ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">尚未建立任何規則。</p>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-start justify-between gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{rule.name}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  當「{rule.triggerColumn.name}」變更為「
                  {statusLabel(rule.triggerColumn, rule.triggerValue)}」時:
                  {rule.notifyUser && <> 通知 {rule.notifyUser.name};</>}
                  {rule.setColumn && (
                    <>
                      {" "}
                      設定「{rule.setColumn.name}」為「
                      {rule.setColumn.type === "STATUS"
                        ? statusLabel(rule.setColumn, String(rule.setValue))
                        : String(rule.setValue)}
                      」;
                    </>
                  )}
                  {rule.moveToGroup && <> 移動到「{rule.moveToGroup.name}」</>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => handleToggle(rule.id, e.target.checked)}
                  />
                  啟用
                </label>
                <button
                  type="button"
                  onClick={() => handleDelete(rule.id)}
                  className="text-neutral-400 dark:text-neutral-500 hover:text-red-600"
                  aria-label="刪除規則"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {statusColumns.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">此看板沒有狀態欄位,無法建立規則。</p>
      ) : (
        <div className="space-y-2 rounded-md border border-neutral-200 dark:border-neutral-700 p-3">
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-100">新增規則</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="規則名稱"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          />

          <div className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 text-neutral-500 dark:text-neutral-400">當狀態變更為</span>
            <select
              value={triggerColumnId}
              onChange={(e) => {
                const col = columns.find((c) => c.id === e.target.value);
                setTriggerColumnId(e.target.value);
                setTriggerValue(col ? getStatusOptions(col.options)[0]?.id ?? "" : "");
              }}
              className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
            >
              {statusColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={triggerValue}
              onChange={(e) => setTriggerValue(e.target.value)}
              className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
            >
              {triggerOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 text-neutral-500 dark:text-neutral-400">通知</span>
            <UserSelect
              users={users.filter((u) => !u.isResource)}
              value={notifyUserId}
              onChange={setNotifyUserId}
              emptyLabel="不通知"
              className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 text-neutral-500 dark:text-neutral-400">設定欄位</span>
            <select
              value={setColumnId}
              onChange={(e) => {
                setSetColumnId(e.target.value);
                setSetValue("");
              }}
              className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
            >
              <option value="">不設定</option>
              {settableColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {setColumn?.type === "STATUS" ? (
              <select
                value={setValue}
                onChange={(e) => setSetValue(e.target.value)}
                className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
              >
                <option value="">選擇狀態</option>
                {setColumnOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : setColumn ? (
              <input
                value={setValue}
                onChange={(e) => setSetValue(e.target.value)}
                type={setColumn.type === "NUMBER" ? "number" : "text"}
                placeholder="值"
                className="w-28 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
              />
            ) : null}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 text-neutral-500 dark:text-neutral-400">移動到分組</span>
            <select
              value={moveToGroupId}
              onChange={(e) => setMoveToGroupId(e.target.value)}
              className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
            >
              <option value="">不移動</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={submitting || !name.trim() || !triggerValue}
            onClick={handleCreate}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "建立中..." : "新增規則"}
          </button>
        </div>
      )}
    </Modal>
  );
}
