"use client";

import { useState } from "react";
import { Shield } from "lucide-react";
import { GroupRolesModal, type GroupRolesData } from "./GroupRolesModal";
import type { UserOption } from "@/types/board";

type BoardWithGroups = { id: string; name: string; roleAssignments: GroupRolesData["roleAssignments"]; groups: GroupRolesData[] };

export function GroupRolesPage({
  boards,
  users,
  leaderOnly = false,
  leaderBoardIds = [],
}: {
  boards: BoardWithGroups[];
  users: UserOption[];
  /** 不是管理者、只是分組的 Team Leader:沒有看板層級的角色可以設,分組裡也只能指定 DM 與 member。 */
  leaderOnly?: boolean;
  /** leaderOnly 時,哪些看板他是看板層級的 Team Leader:這些看板才有「整個看板」的「看板角色」可以指定 DM。 */
  leaderBoardIds?: string[];
}) {
  // Track only the ids, not a copy of the group — the group's own data must
  // keep flowing from the `boards` prop (refreshed after every role toggle)
  // rather than a stale snapshot taken when the modal was opened.
  // groupId 是 null 就是看板層級的角色。
  const [target, setTarget] = useState<{ boardId: string; groupId: string | null } | null>(null);
  const targetBoard = target ? boards.find((b) => b.id === target.boardId) : null;
  const targetData: GroupRolesData | null = !target || !targetBoard
    ? null
    : target.groupId === null
      ? { id: targetBoard.id, name: targetBoard.name, roleAssignments: targetBoard.roleAssignments, roleOverrides: [], members: [], resourceMembers: [] }
      : (targetBoard.groups.find((g) => g.id === target.groupId) ?? null);

  return (
    <div className="space-y-6">
      {boards.map((board) => (
        <section key={board.id}>
          <h2 className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">{board.name}</h2>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-700 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
            {(!leaderOnly || leaderBoardIds.includes(board.id)) && (
            <div className="flex items-center justify-between bg-neutral-50 px-4 py-2.5 dark:bg-neutral-800/50">
              <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                整個看板
                <span className="ml-2 text-xs font-normal text-neutral-400 dark:text-neutral-500">分組預設沿用這裡的角色</span>
              </span>
              <button
                type="button"
                onClick={() => setTarget({ boardId: board.id, groupId: null })}
                data-board-roles-button={board.id}
                className="flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <Shield size={13} /> 看板角色
              </button>
            </div>
            )}
            {board.groups.map((group) => (
              <div key={group.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-neutral-700 dark:text-neutral-100">{group.name}</span>
                <button
                  type="button"
                  onClick={() => setTarget({ boardId: board.id, groupId: group.id })}
                  data-group-roles-button={group.id}
                  className="flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <Shield size={13} /> 設定角色
                </button>
              </div>
            ))}
            {board.groups.length === 0 && (
              <p className="px-4 py-3 text-sm text-neutral-400 dark:text-neutral-500">此看板尚無分組</p>
            )}
          </div>
        </section>
      ))}
      {boards.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">尚無看板</p>}

      {target && targetData && (
        <GroupRolesModal
          mode={target.groupId === null ? "board" : "group"}
          leaderOnly={leaderOnly}
          boardId={target.boardId}
          group={targetData}
          users={users}
          open={target !== null}
          onOpenChange={(open) => !open && setTarget(null)}
        />
      )}
    </div>
  );
}
