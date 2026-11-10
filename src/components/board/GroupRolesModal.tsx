"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { MultiSelect } from "@/components/ui/MultiSelect";
import type { UserOption } from "@/types/board";
import type { GroupDiscipline, GroupRole } from "@prisma/client";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  setBoardRoleAssignments,
  setGroupRoleAssignments,
  setGroupRoleInherit,
  setGroupMembers,
  setGroupMemberInherit,
  setGroupResourceMembers,
  setGroupResourceInherit,
  setBoardMembers,
  setBoardResourceMembers,
} from "@/lib/actions/groupRoles";

/** The slice of Group data this modal actually needs — kept structural
 *  (rather than importing the full GroupData) so both the board page's
 *  BoardWithData groups AND the leaner /group-roles listing query satisfy it. */
export type GroupRolesData = {
  id: string;
  name: string;
  roleAssignments: { role: GroupRole; userId: string }[];
  /** 這個分組自己設定的角色(不沿用看板)。看板層級(mode="board")用不到,給空陣列。 */
  roleOverrides: GroupRole[];
  /** 實作成員。看板層級(mode="board")放的是看板的名單。 */
  members: { discipline: GroupDiscipline; userId: string }[];
  /** 這個分組自己設定實作成員的職能(不沿用看板)。看板層級用不到,給空陣列。 */
  memberOverrides: GroupDiscipline[];
  /** Resource 成員。看板層級(mode="board")放的是看板的名單。 */
  resourceMembers: { resourceId: string }[];
  /** 這個分組自己設定 Resource 成員(不沿用看板)。看板層級用不到,給 false。 */
  resourceOverride: boolean;
};

export const ROLE_LABELS: Record<GroupRole, string> = {
  TEAM_LEADER: "Team Leader",
  SW_DM: "SW DM",
  HW_DM: "EE DM",
  ME_DM: "ME DM",
  QA: "QA DM",
  PMM: "PMM(行銷 PM)",
  PMD: "PMD(專案 PM)",
  // 刻意跟上面兩個「PM」開頭的角色分開措辭——PMD/PMM 管的是整個分組/整個
  // 看板,PM_DM 是「PM 這個職能」的 DM,是完全不同的概念,標籤要一眼看得
  // 出差異,不然容易被當成同一種角色。
  PM_DM: "PM DM(專案管理)",
};
const ROLES: GroupRole[] = ["TEAM_LEADER", "SW_DM", "HW_DM", "ME_DM", "QA", "PM_DM", "PMM", "PMD"];
const DISCIPLINES: GroupDiscipline[] = ["SW", "HW", "ME", "QA", "PM"];
/** Team Leader 可以在自己的分組指定的角色(各職能的 DM);跟 groupRoles 動作裡的限制同一份。 */
const LEADER_ASSIGNABLE_ROLES: GroupRole[] = ["SW_DM", "HW_DM", "ME_DM", "QA", "PM_DM"];

/** 畫面上的部門名稱。HW 這個列舉值對外一律叫 EE。 */
export const DISCIPLINE_LABELS: Record<GroupDiscipline, string> = {
  SW: "SW",
  HW: "EE",
  ME: "ME",
  QA: "QA",
  PM: "PM",
};

/**
 * 哪個角色綁哪個部門。
 *
 * DM 是「帶某個部門的人」,所以人選就該從那個部門裡挑;Team Leader、PMM、
 * PMD 管的是整個分組,任何部門的人都可以擔任,所以是 null。
 */
const ROLE_DISCIPLINE: Record<GroupRole, GroupDiscipline | null> = {
  TEAM_LEADER: null,
  SW_DM: "SW",
  HW_DM: "HW",
  ME_DM: "ME",
  QA: "QA",
  PM_DM: "PM",
  PMM: null,
  PMD: null,
};

/**
 * 部門代號可能對不上使用者身上的單位。
 *
 * 分組職能的列舉值是固定的 SW/HW/ME/QA/PM,而「公司組織單位」是設定出來的
 * (預設 EE/ME/SW/QA/FAE/PM)。HW 這一支對外叫 EE,所以先比 EE;舊資料裡
 * 如果真的有人的單位是 HW,也一併收,不然那些人會突然從清單上消失。
 */
const UNIT_ALIASES: Record<GroupDiscipline, string[]> = {
  SW: ["SW"],
  HW: ["EE", "HW"],
  ME: ["ME"],
  QA: ["QA"],
  PM: ["PM"],
};

function inDiscipline(user: UserOption, discipline: GroupDiscipline): boolean {
  const unit = (user.discipline ?? "").toUpperCase();
  return UNIT_ALIASES[discipline].includes(unit);
}

/**
 * mode="group":一個分組的角色、實作成員、Resource;每個角色可以「沿用看板」或自己設定。
 * mode="board":看板層級的角色(group 參數放的是看板:id=看板 id、name=看板名稱),
 * 所有沒有自己設定的分組都跟著這裡走。
 */
export function GroupRolesModal({
  boardId,
  group,
  users,
  open,
  onOpenChange,
  mode = "group",
  leaderOnly = false,
}: {
  boardId: string;
  group: GroupRolesData;
  users: UserOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "group" | "board";
  /** 只是這個分組的 Team Leader(不是管理者):只能指定 DM 與各職能 member,其他角色與 Resource 唯讀。 */
  leaderOnly?: boolean;
}) {
  const router = useRouter();
  const { notify } = useDialogs();
  const boardMode = mode === "board";
  const [pending, setPending] = useState<string | null>(null);
  /** 哪幾列被要求「顯示全部部門」。key 跟 pending 同一套命名。 */
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const realUsers = users.filter((u) => !u.isResource);
  const resources = users.filter((u) => u.isResource);

  function toggleShowAll(key: string) {
    setShowAll((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * 這一列可以挑誰。
   *
   * 沒綁部門就是全部人。綁了部門就只給那個部門的人 —— 但那個部門一個人都
   * 沒有的時候直接給全部,否則畫面上會是一個永遠選不到東西的空清單,而真正
   * 的原因(沒有人的單位設成 SW)在另一頁,使用者不會知道。
   *
   * 已經被選進來的人一定留在清單裡,即使他不屬於這個部門:篩掉他的話,他
   * 還掛著這個角色卻沒有任何地方可以把他拿掉,而畫面上完全看不出來。
   */
  function optionsFor(key: string, discipline: GroupDiscipline | null, selectedIds: Set<string>) {
    if (!discipline) return { options: realUsers, scoped: false, deptEmpty: false };
    const inDept = realUsers.filter((u) => inDiscipline(u, discipline));
    if (inDept.length === 0) return { options: realUsers, scoped: false, deptEmpty: true };
    if (showAll.has(key)) return { options: realUsers, scoped: false, deptEmpty: false };

    const shown = new Set(inDept.map((u) => u.id));
    const strays = realUsers.filter((u) => selectedIds.has(u.id) && !shown.has(u.id));
    return { options: [...inDept, ...strays], scoped: true, deptEmpty: false };
  }

  async function toggleRole(role: GroupRole, userId: string) {
    const current = group.roleAssignments.filter((a) => a.role === role).map((a) => a.userId);
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    setPending(`role:${role}`);
    try {
      if (boardMode) {
        const result = await setBoardRoleAssignments(boardId, role, next);
        if (result.error) await notify(result.error);
      } else {
        const result = await setGroupRoleAssignments(boardId, group.id, role, next);
        if (result.error) await notify(result.error);
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  /** 分組的某個角色:改成沿用看板 / 改成自己設定。 */
  async function toggleInherit(role: GroupRole, inherit: boolean) {
    setPending(`role:${role}`);
    try {
      const result = await setGroupRoleInherit(boardId, group.id, role, inherit);
      if (result.error) await notify(result.error);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function toggleMember(discipline: GroupDiscipline, userId: string) {
    const current = group.members.filter((m) => m.discipline === discipline).map((m) => m.userId);
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    setPending(`member:${discipline}`);
    try {
      const result = boardMode
        ? await setBoardMembers(boardId, discipline, next)
        : await setGroupMembers(boardId, group.id, discipline, next);
      if (result.error) await notify(result.error);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  /** 分組的某個職能的實作成員:改成沿用看板 / 改成自己設定。 */
  async function toggleMemberInherit(discipline: GroupDiscipline, inherit: boolean) {
    setPending(`member:${discipline}`);
    try {
      const result = await setGroupMemberInherit(boardId, group.id, discipline, inherit);
      if (result.error) await notify(result.error);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function toggleResource(resourceId: string) {
    const current = group.resourceMembers.map((m) => m.resourceId);
    const next = current.includes(resourceId)
      ? current.filter((id) => id !== resourceId)
      : [...current, resourceId];
    setPending("resource");
    try {
      if (boardMode) {
        const result = await setBoardResourceMembers(boardId, next);
        if (result.error) await notify(result.error);
      } else {
        await setGroupResourceMembers(boardId, group.id, next);
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  /** 分組的 Resource 成員:改成沿用看板 / 改成自己設定。 */
  async function toggleResourceInherit(inherit: boolean) {
    setPending("resource");
    try {
      const result = await setGroupResourceInherit(boardId, group.id, inherit);
      if (result.error) await notify(result.error);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  /** 「只看本部門 / 顯示全部」那個開關,以及部門是空的時候的說明。 */
  function scopeFooter(key: string, discipline: GroupDiscipline | null, deptEmpty: boolean) {
    if (!discipline) return null;
    if (deptEmpty) {
      return (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          還沒有人的單位設成 {UNIT_ALIASES[discipline].join(" 或 ")},先在「使用者管理」設好單位,
          這裡就會只列該部門的人。目前先列出全部。
        </p>
      );
    }
    return (
      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
        <input
          type="checkbox"
          checked={showAll.has(key)}
          onChange={() => toggleShowAll(key)}
          className="h-3 w-3"
        />
        顯示其他部門的人
      </label>
    );
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={boardMode ? `${group.name} — 看板角色與成員` : `${group.name} — 分組角色設定`} size="xl">
      <div className="space-y-5">
        <section>
          <h3 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">角色</h3>
          <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
            {boardMode
              ? "設在這裡的角色,這個看板的每個分組預設都沿用(Team Leader 就是這個專案的負責人)。分組如果自己改過某個角色,就以分組的為準,不受這裡影響;分組可以在「分組角色設定」逐一角色改回沿用看板。"
              : "每個角色旁邊勾「沿用看板」,名單就跟看板設定的一樣、看板改了也跟著改;取消勾選才能在這個分組另外挑人。"}
            Team Leader 與 PMD(專案 PM)可調整分組任何項目的時程(拖曳甘特圖、改起訖日)。
            SW/EE/ME/QA DM 可在分組新增/指派項目、管理各自領域成員的進度,範圍僅限該分組。
            PMM(行銷 PM)不授予額外權限,週報的「依職能的工作項」會獨立列出他名下的工作項。
            DM 的人選預設只列該部門的人,Team Leader / PMM / PMD 則是任一部門任一人。
          </p>
          <div className="space-y-2">
            {ROLES.map((role) => {
              const key = `role:${role}`;
              const discipline = ROLE_DISCIPLINE[role];
              const selectedIds = new Set(
                group.roleAssignments.filter((a) => a.role === role).map((a) => a.userId)
              );
              const { options, scoped, deptEmpty } = optionsFor(key, discipline, selectedIds);
              // Team Leader 只能改 DM:這幾列直接可編(第一次改就變成這個分組自己的名單),不需要「沿用看板」開關;其他角色唯讀。
              const leaderCanEdit = leaderOnly && LEADER_ASSIGNABLE_ROLES.includes(role);
              const inherited = !boardMode && !leaderOnly && !group.roleOverrides.includes(role);
              const readOnly = leaderOnly && !leaderCanEdit;
              return (
                <div key={role} className="flex items-center gap-2" data-role-row={role}>
                  <span className="w-32 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    {ROLE_LABELS[role]}
                  </span>
                  <MultiSelect
                    options={options.map((u) => ({
                      id: u.id,
                      name: u.name,
                      hint: scoped ? undefined : (u.discipline ?? undefined),
                    }))}
                    selectedIds={selectedIds}
                    disabled={pending === key || inherited || readOnly}
                    placeholder={
                      discipline && scoped ? `未指定(${DISCIPLINE_LABELS[discipline]} 部門)` : "未指定"
                    }
                    emptyText="沒有可選的人"
                    footer={scopeFooter(key, discipline, deptEmpty)}
                    onToggle={(userId) => toggleRole(role, userId)}
                  />
                  {!boardMode && !leaderOnly && (
                    <label
                      className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400"
                      title="勾選:名單跟看板設定的一樣,看板改了這裡跟著改。取消勾選:這個分組自己挑人。"
                    >
                      <input
                        type="checkbox"
                        checked={inherited}
                        disabled={pending === key}
                        onChange={(e) => void toggleInherit(role, e.target.checked)}
                        className="h-3 w-3"
                        data-role-inherit={role}
                      />
                      沿用看板
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">實作成員</h3>
          <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
            {boardMode
              ? "設在這裡的實作成員,這個看板的每個分組預設都沿用。分組如果自己改過某個職能,就以分組的為準,不受這裡影響;分組可以在「分組角色設定」逐一職能改回沿用看板。"
              : "每個職能旁邊勾「沿用看板」,名單就跟看板設定的一樣、看板改了也跟著改;取消勾選才能在這個分組另外挑人。"}
            SW/EE/ME/QA DM 只能管理各自欄位底下列出的成員。人選同樣預設只列該部門的人。
          </p>
          <div className="space-y-2">
            {DISCIPLINES.map((discipline) => {
              const key = `member:${discipline}`;
              const selectedIds = new Set(
                group.members.filter((m) => m.discipline === discipline).map((m) => m.userId)
              );
              const { options, scoped, deptEmpty } = optionsFor(key, discipline, selectedIds);
              // Team Leader 直接可編(第一次改就變成這個分組自己的名單),不需要「沿用看板」開關。
              const inherited = !boardMode && !leaderOnly && !group.memberOverrides.includes(discipline);
              return (
                <div key={discipline} className="flex items-center gap-2" data-member-row={discipline}>
                  <span className="w-32 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    {DISCIPLINE_LABELS[discipline]} member
                  </span>
                  <MultiSelect
                    options={options.map((u) => ({
                      id: u.id,
                      name: u.name,
                      hint: scoped ? undefined : (u.discipline ?? undefined),
                    }))}
                    selectedIds={selectedIds}
                    disabled={pending === key || inherited}
                    placeholder={scoped ? `未指定(${DISCIPLINE_LABELS[discipline]} 部門)` : "未指定"}
                    footer={scopeFooter(key, discipline, deptEmpty)}
                    onToggle={(userId) => toggleMember(discipline, userId)}
                  />
                  {!boardMode && !leaderOnly && (
                    <label
                      className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400"
                      title="勾選:名單跟看板設定的一樣,看板改了這裡跟著改。取消勾選:這個分組自己挑人。"
                    >
                      <input
                        type="checkbox"
                        checked={inherited}
                        disabled={pending === key}
                        onChange={(e) => void toggleMemberInherit(discipline, e.target.checked)}
                        className="h-3 w-3"
                        data-member-inherit={discipline}
                      />
                      沿用看板
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {!leaderOnly && resources.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">Resource 成員</h3>
            <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
              {boardMode
                ? "花名冊用途,Resource 沒有登入帳號、不會取得任何操作權限。設在這裡的名單,這個看板的每個分組預設都沿用;分組自己改過就以分組的為準,可以在「分組角色設定」改回沿用看板。"
                : "花名冊用途,Resource 沒有登入帳號、不會取得任何操作權限。勾「沿用看板」,名單就跟看板設定的一樣、看板改了也跟著改;取消勾選才能在這個分組另外挑。"}
            </p>
            <div className="flex items-center gap-2" data-resource-row>
              <span className="w-32 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Resource
              </span>
              <MultiSelect
                options={resources.map((r) => ({ id: r.id, name: r.name }))}
                selectedIds={new Set(group.resourceMembers.map((m) => m.resourceId))}
                disabled={pending === "resource" || (!boardMode && !group.resourceOverride)}
                onToggle={toggleResource}
              />
              {!boardMode && (
                <label
                  className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400"
                  title="勾選:名單跟看板設定的一樣,看板改了這裡跟著改。取消勾選:這個分組自己挑。"
                >
                  <input
                    type="checkbox"
                    checked={!group.resourceOverride}
                    disabled={pending === "resource"}
                    onChange={(e) => void toggleResourceInherit(e.target.checked)}
                    className="h-3 w-3"
                    data-resource-inherit
                  />
                  沿用看板
                </label>
              )}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
