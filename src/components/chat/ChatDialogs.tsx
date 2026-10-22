"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { UserSelect } from "@/components/ui/UserSelect";

type ChatUser = { id: string; name: string; avatarUrl: string | null };

const primaryButton = "rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50";
const cancelButton =
  "rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800";
const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

/** 新私訊:挑一個人。 */
export function NewDirectChatDialog({
  open,
  onOpenChange,
  users,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已經排除自己。 */
  users: ChatUser[];
  onPick: (userId: string) => void;
}) {
  const [userId, setUserId] = useState("");
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="新私訊">
      <div className="space-y-4">
        <UserSelect users={users} value={userId} onChange={setUserId} placeholder="選一個人…" />
        <div className="flex justify-end gap-2">
          <button type="button" className={cancelButton} onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={!userId}
            onClick={() => {
              onPick(userId);
              setUserId("");
              onOpenChange(false);
            }}
          >
            開始聊天
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 新群組:名稱與成員。 */
export function NewGroupChatDialog({
  open,
  onOpenChange,
  users,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: ChatUser[];
  onCreate: (title: string, memberIds: string[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="新群組聊天室">
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-600 dark:text-neutral-300">名稱</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如:DVT 試作討論" maxLength={40} className={inputClass} />
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-neutral-600 dark:text-neutral-300">成員(你會自動加入)</span>
          <MultiSelect
            options={users.map((u) => ({ id: u.id, name: u.name }))}
            selectedIds={selected}
            placeholder="選成員…"
            summaryLimit={6}
            onToggle={(id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (!next.delete(id)) next.add(id);
                return next;
              })
            }
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={cancelButton} onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={!title.trim() || selected.size === 0}
            onClick={() => {
              onCreate(title, [...selected]);
              setTitle("");
              setSelected(new Set());
              onOpenChange(false);
            }}
          >
            建立
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 群組加成員:只列還不在裡面的人。 */
export function AddMembersDialog({
  open,
  onOpenChange,
  candidates,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: ChatUser[];
  onAdd: (userIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="加成員">
      <div className="space-y-4">
        <MultiSelect
          options={candidates.map((u) => ({ id: u.id, name: u.name }))}
          selectedIds={selected}
          placeholder="選要加的人…"
          emptyText="所有人都已經在這個群組裡了"
          summaryLimit={6}
          onToggle={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (!next.delete(id)) next.add(id);
              return next;
            })
          }
        />
        <div className="flex justify-end gap-2">
          <button type="button" className={cancelButton} onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={selected.size === 0}
            onClick={() => {
              onAdd([...selected]);
              setSelected(new Set());
              onOpenChange(false);
            }}
          >
            加入
          </button>
        </div>
      </div>
    </Modal>
  );
}
