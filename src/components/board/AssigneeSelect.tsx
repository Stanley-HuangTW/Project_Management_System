"use client";

import { useEffect, useRef, useState } from "react";
import { listAssignableUsers, suggestTodoAssignee } from "@/lib/actions/todoAssignee";
import { ASSIGNEE_REASON_LABELS, type AssigneeReason } from "@/lib/todoAssignee";

export type AssignableUser = { id: string; name: string };

/** 待辦事項處理者的人選(公司所有人員),載入一次。 */
export function useAssignableUsers(): AssignableUser[] {
  const [users, setUsers] = useState<AssignableUser[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listAssignableUsers().then((list) => {
      if (!cancelled) setUsers(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return users;
}

/**
 * 新增待辦事項時的處理者:預設照規則帶入(文字裡 @ 的人 → 負責人 → 人員分配 / 工時比例最高的人,見 todoAssignee),
 * 使用者自己改過就不再被預設蓋掉。target 是 null(還沒挑項目)就先不帶。
 * assigneeId 是 "" 代表不指定。
 */
export function useSuggestedAssignee(target: { kind: "item" | "risk"; id: string } | null, text: string) {
  const [assigneeId, setAssigneeId] = useState("");
  const [reason, setReason] = useState<AssigneeReason | null>(null);
  const touched = useRef(false);
  const lastTarget = useRef<string | null>(null);
  const kind = target?.kind;
  const id = target?.id;

  useEffect(() => {
    // 換了一個項目:預設是那個項目的負責人,不是上一個項目的——使用者之前自己選的不帶過去。
    const targetKey = kind && id ? `${kind}:${id}` : null;
    if (targetKey !== lastTarget.current) {
      lastTarget.current = targetKey;
      touched.current = false;
    }
    if (!kind || !id || touched.current) return;
    let stale = false;
    // 文字還在打的時候等一下再問,@ 到誰才會跟上;沒有文字就馬上問。
    const timer = setTimeout(
      () => {
        void suggestTodoAssignee({ kind, id }, text).then((result) => {
          if (stale || touched.current) return;
          setAssigneeId(result.userId ?? "");
          setReason(result.reason);
        });
      },
      text ? 400 : 0
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [kind, id, text]);

  return {
    assigneeId,
    reason,
    /** 使用者自己選的——之後預設不再蓋掉它。 */
    choose(next: string) {
      touched.current = true;
      setAssigneeId(next);
      setReason(null);
    },
    /** 新增完一筆之後回到預設。 */
    reset() {
      touched.current = false;
      setAssigneeId("");
      setReason(null);
    },
  };
}

/** 預設是怎麼來的(畫面上的小字);使用者自己選的就沒有。 */
export function reasonText(reason: AssigneeReason | null): string | null {
  return reason ? `預設:${ASSIGNEE_REASON_LABELS[reason]}` : null;
}

export function AssigneeSelect({
  value,
  users,
  onChange,
  title,
  className = "",
  ...rest
}: {
  /** "" = 不指定。 */
  value: string;
  users: AssignableUser[];
  onChange: (next: string) => void;
  title?: string;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  // 處理者的帳號已經不在人選裡(被刪除)時,選單還是要顯示出「有人」,不能默默變成未指定。
  const missing = value && !users.some((u) => u.id === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title ?? "處理者:這個待辦事項由誰完成(到期提醒會通知他)"}
      aria-label="處理者"
      className={`rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs text-neutral-700 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 ${className}`}
      {...rest}
    >
      <option value="">未指定</option>
      {missing && <option value={value}>(已刪除的使用者)</option>}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}
