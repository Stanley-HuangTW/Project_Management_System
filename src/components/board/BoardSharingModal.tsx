"use client";

import { UserSelect } from "@/components/ui/UserSelect";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { UserOption } from "@/types/board";
import type { BoardVisibility } from "@prisma/client";
import {
  setBoardVisibility,
  listBoardMembers,
  addBoardMember,
  removeBoardMember,
  listBoardGroupRoles,
  addBoardMembersFromGroupRole,
  listBoardGroupMembers,
  addBoardMembersFromGroupMembers,
  type BoardGroupRoleOption,
  type BoardGroupMemberOption,
} from "@/lib/actions/board";
import { ROLE_LABELS, DISCIPLINE_LABELS } from "./GroupRolesModal";
import { BudgetViewersSection } from "./BudgetViewersSection";
import { actionErrorMessage } from "@/lib/userError";

type BoardMemberRow = Awaited<ReturnType<typeof listBoardMembers>>[number];

export function BoardSharingModal({
  boardId,
  visibility,
  users,
  open,
  onOpenChange,
}: {
  boardId: string;
  visibility: BoardVisibility;
  users: UserOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [members, setMembers] = useState<BoardMemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [groupRoleOptions, setGroupRoleOptions] = useState<BoardGroupRoleOption[]>([]);
  const [groupRoleKey, setGroupRoleKey] = useState("");
  const [addingByRole, setAddingByRole] = useState(false);
  const [groupMemberOptions, setGroupMemberOptions] = useState<BoardGroupMemberOption[]>([]);
  const [groupMemberKey, setGroupMemberKey] = useState("");
  const [addingByMember, setAddingByMember] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [rows, roleOptions, memberOptions] = await Promise.all([
          listBoardMembers(boardId),
          listBoardGroupRoles(boardId),
          listBoardGroupMembers(boardId),
        ]);
        if (!cancelled) {
          setMembers(rows);
          setGroupRoleOptions(roleOptions);
          setGroupMemberOptions(memberOptions);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function handleVisibilityChange(next: BoardVisibility) {
    setError(null);
    try {
      await setBoardVisibility(boardId, next);
    } catch (err) {
      setError(actionErrorMessage(err, "設定失敗"));
    }
  }

  async function handleAddMember() {
    if (!addUserId) return;
    setError(null);
    try {
      await addBoardMember(boardId, addUserId);
      setMembers(await listBoardMembers(boardId));
      setAddUserId("");
    } catch (err) {
      setError(actionErrorMessage(err, "新增失敗"));
    }
  }

  async function handleRemoveMember(userId: string) {
    setError(null);
    try {
      await removeBoardMember(boardId, userId);
      setMembers(await listBoardMembers(boardId));
    } catch (err) {
      setError(actionErrorMessage(err, "移除失敗"));
    }
  }

  async function handleAddByRole() {
    if (!groupRoleKey) return;
    const [groupId, role] = groupRoleKey.split("|");
    setAddingByRole(true);
    setError(null);
    try {
      const result = await addBoardMembersFromGroupRole(boardId, groupId, role as BoardGroupRoleOption["role"]);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMembers(await listBoardMembers(boardId));
      setGroupRoleKey("");
    } catch (err) {
      setError(actionErrorMessage(err, "新增失敗"));
    } finally {
      setAddingByRole(false);
    }
  }

  async function handleAddByMember() {
    if (!groupMemberKey) return;
    const [groupId, discipline] = groupMemberKey.split("|");
    setAddingByMember(true);
    setError(null);
    try {
      const result = await addBoardMembersFromGroupMembers(
        boardId,
        groupId,
        discipline as BoardGroupMemberOption["discipline"]
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setMembers(await listBoardMembers(boardId));
      setGroupMemberKey("");
    } catch (err) {
      setError(actionErrorMessage(err, "新增失敗"));
    } finally {
      setAddingByMember(false);
    }
  }

  const memberIds = new Set(members.map((m) => m.user.id));
  const nonMembers = users.filter((u) => !u.isResource && !memberIds.has(u.id));

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="看板分享設定">
      {error && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="mb-4 space-y-2">
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-100">
          <input
            type="radio"
            name="visibility"
            checked={visibility === "PUBLIC"}
            onChange={() => handleVisibilityChange("PUBLIC")}
          />
          公開 — 所有登入使用者可存取
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-100">
          <input
            type="radio"
            name="visibility"
            checked={visibility === "RESTRICTED"}
            onChange={() => handleVisibilityChange("RESTRICTED")}
          />
          限制 — 只有擁有者、管理者與下方指定成員可存取
        </label>
      </div>

      {visibility === "RESTRICTED" && (
        <div>
          <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
            這個看板底下任何分組有角色(Team Leader/DM/QA...)或是 SW/EE/ME/QA 實作成員的人,不用加進下面的名單也一律看得到——這裡只管理額外再加的人。
          </p>
          <div className="mb-2 flex items-center gap-2">
            <UserSelect users={nonMembers} value={addUserId} onChange={setAddUserId} placeholder="選擇要新增的成員" className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
            <button
              type="button"
              onClick={handleAddMember}
              disabled={!addUserId}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              新增
            </button>
          </div>

          {groupRoleOptions.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <select
                value={groupRoleKey}
                onChange={(e) => setGroupRoleKey(e.target.value)}
                className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="">依分組角色批次加入...</option>
                {groupRoleOptions.map((o) => (
                  <option key={`${o.groupId}|${o.role}`} value={`${o.groupId}|${o.role}`}>
                    {o.groupName} - {ROLE_LABELS[o.role]}({o.userIds.length} 人)
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddByRole}
                disabled={!groupRoleKey || addingByRole}
                className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
              >
                {addingByRole ? "加入中..." : "加入"}
              </button>
            </div>
          )}

          {groupMemberOptions.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <select
                value={groupMemberKey}
                onChange={(e) => setGroupMemberKey(e.target.value)}
                className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="">依分組實作成員批次加入...</option>
                {groupMemberOptions.map((o) => (
                  <option key={`${o.groupId}|${o.discipline}`} value={`${o.groupId}|${o.discipline}`}>
                    {o.groupName} - {DISCIPLINE_LABELS[o.discipline]} 實作成員({o.userIds.length} 人)
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddByMember}
                disabled={!groupMemberKey || addingByMember}
                className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
              >
                {addingByMember ? "加入中..." : "加入"}
              </button>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">目前沒有額外成員(擁有者與管理者一律可存取)</p>
          ) : (
            <ul className="space-y-1">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-1.5 text-sm"
                >
                  <span className="text-neutral-800 dark:text-neutral-100">{m.user.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(m.user.id)}
                    className="text-neutral-400 dark:text-neutral-500 hover:text-red-600"
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <BudgetViewersSection boardId={boardId} users={users} />
    </Modal>
  );
}
