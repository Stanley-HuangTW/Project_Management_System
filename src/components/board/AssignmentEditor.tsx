"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { Avatar } from "@/components/ui/Avatar";
import { PersonPicker } from "@/components/ui/PersonPicker";
import { PercentInput } from "@/components/ui/PercentInput";
import { subordinateIds } from "@/lib/orgChart";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError } from "@/lib/staleBuild";
import {
  listAssignments,
  upsertAssignment,
  removeAssignment,
} from "@/lib/actions/assignment";
import type { UserOption } from "@/types/board";
import { actionErrorMessage } from "@/lib/userError";

/**
 * 人員分配 —— 誰花多少比例在這個工作項上。
 *
 * 人員分配視窗與項目卡片兩邊都要有,而且必須是同一套行為:同樣的可指派
 * 範圍、同樣的百分比級距、同樣的即時儲存。所以它在這裡,不在任何一邊。
 *
 * 跟 PERSON 欄位的「負責人」是兩回事:負責人可以是 Resource(治具、廠商),
 * 人員分配指向真的 User,因為它要換算成工時與成本。
 */
export function AssignmentEditor({
  boardId,
  itemId,
  users,
  userRole,
  currentUserId,
  canEdit = true,
  onChanged,
}: {
  boardId: string;
  itemId: string;
  users: UserOption[];
  userRole: UserRole;
  currentUserId: string;
  canEdit?: boolean;
  /** 分配改了之後要重新整理畫面的呼叫端(甘特圖的長條、工作量)。 */
  onChanged?: () => void;
}) {
  const [assignments, setAssignments] = useState<
    Awaited<ReturnType<typeof listAssignments>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [pct, setPct] = useState(10);
  const [busy, setBusy] = useState(false);
  const { notify } = useDialogs();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await listAssignments(itemId);
        if (!cancelled) setAssignments(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // 人員分配指向真的 User(外鍵),Resource(治具/廠商)可以當 PERSON 欄位的
  // 負責人,但不能有百分比配置。
  const realUsers = users.filter((u) => !u.isResource);
  const below = subordinateIds(users, currentUserId);
  const assignableUsers =
    userRole === "SUPERVISOR" ? realUsers.filter((u) => below.has(u.id)) : realUsers;
  const assignedUserIds = new Set(assignments.map((a) => a.userId));
  const availableUsers = assignableUsers.filter((u) => !assignedUserIds.has(u.id));

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      setAssignments(await listAssignments(itemId));
      onChanged?.();
    } catch (err) {
      await notify(
        actionErrorMessage(err, "操作失敗"),
        { title: isStaleBuildError(err) ? "需要重新整理" : "無法變更人員分配" }
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>}
      {!loading && assignments.length === 0 && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">尚未指派人員</p>
      )}

      {assignments.map((a) => (
        <div
          key={a.userId}
          className="flex items-center justify-between rounded-md bg-neutral-50 px-3 py-2 dark:bg-neutral-800"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
            <Avatar name={a.user.name} avatarUrl={a.user.avatarUrl} size={22} />
            <span className="truncate">{a.user.name}</span>
          </span>
          <div className="flex items-center gap-2">
            <PercentInput
              value={a.allocationPct}
              delayMs={500}
              disabled={!canEdit}
              onChange={(pct) => run(() => upsertAssignment(boardId, itemId, a.userId, pct))}
              className="w-16 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900"
            />
            <span className="text-sm text-neutral-500 dark:text-neutral-400">%</span>
            {canEdit && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => removeAssignment(boardId, itemId, a.userId))}
                className="text-neutral-400 hover:text-red-600 disabled:opacity-50 dark:text-neutral-500"
                aria-label="移除"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      ))}

      {canEdit && availableUsers.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 rounded-md border border-neutral-300 dark:border-neutral-600">
            <PersonPicker
              users={availableUsers}
              selectedId={selectedUserId || null}
              onSelect={(userId: string | null) => setSelectedUserId(userId ?? "")}
            />
          </div>
          <PercentInput
            value={pct}
            onChange={setPct}
            className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
          />
          <span className="text-sm text-neutral-500 dark:text-neutral-400">%</span>
          <button
            type="button"
            disabled={!selectedUserId || busy}
            onClick={() =>
              run(async () => {
                await upsertAssignment(boardId, itemId, selectedUserId, pct);
                setSelectedUserId("");
                setPct(10);
              })
            }
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            新增
          </button>
        </div>
      )}

      {canEdit && availableUsers.length === 0 && userRole === "SUPERVISOR" && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          你的團隊目前沒有可指派的成員。
        </p>
      )}
    </div>
  );
}
