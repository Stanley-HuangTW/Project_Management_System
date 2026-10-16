"use client";

import { UserSelect } from "@/components/ui/UserSelect";
import { useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, KeyRound, Lock, Pencil, Plus, Trash2, Unlock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { useDialogs } from "@/components/ui/DialogProvider";
import { subordinateIds, orgDepth } from "@/lib/orgChart";
import {
  createUser,
  updateUser,
  updateUserSupervisor,
  updateUserAvatar,
  deleteUser,
  reorderUsers,
  listUsers,
  updateUserHourlyRate,
  updateUserDiscipline,
  updateUserMonthlySalary,
  updateUserTimesheetAccess,
  updateUserTimesheetNoApproval,
  adminResetUserPassword,
  unlockUser,
} from "@/lib/actions/user";
import type { UserRole } from "@prisma/client";
import type { Discipline } from "@/lib/labourPlan";
import { unitLabel, type OrgUnit } from "@/lib/orgUnits";
import { fileToAvatarDataUrl } from "@/lib/avatarImage";
import { HScrollPane } from "@/components/ui/HScrollPane";

type UserRow = Awaited<ReturnType<typeof listUsers>>[number];

/**
 * 姓名與 Email 給的是 minmax 而不是 1fr。
 *
 * 1fr 實際上是 minmax(auto, 1fr),欄位一多就會被其他固定寬度的欄擠到剩幾
 * 個 px —— 加上 truncate,結果是整欄看起來空白,而不是被截斷。給一個下限
 * 之後,寬度不夠時會撐出容器,由外層的 overflow-x-auto 捲,兩欄都還讀得到。
 */
const ROW_GRID =
  "grid-cols-[24px_48px_minmax(120px,1.1fr)_minmax(190px,1.4fr)_90px_110px_100px_110px_110px_150px_110px]";

function roleLabel(role: UserRole) {
  return role === "ADMIN" ? "管理者" : role === "SUPERVISOR" ? "主管" : "團隊成員";
}

/**
 * 每小時人力成本. Saved on blur rather than on every keystroke: typing "600"
 * would otherwise write 6, then 60, then 600, and the middle two are wrong
 * rates that a report could be read at.
 */
function RateInput({ user }: { user: UserRow }) {
  const [value, setValue] = useState(user.hourlyRate === null ? "" : String(user.hourlyRate));
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = value.trim() === "" ? null : Number(value);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setValue(user.hourlyRate === null ? "" : String(user.hourlyRate));
      return;
    }
    if (next === user.hourlyRate) return;
    setSaving(true);
    try {
      await updateUserHourlyRate(user.id, next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      type="number"
      min={0}
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="未設定"
      title="每小時人力成本(元)"
      className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-50"
    />
  );
}

/** 月薪。跟 RateInput 一樣離開欄位才存,理由相同。 */
function SalaryInput({ user }: { user: UserRow }) {
  const [value, setValue] = useState(user.monthlySalary === null ? "" : String(user.monthlySalary));
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = value.trim() === "" ? null : Number(value);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setValue(user.monthlySalary === null ? "" : String(user.monthlySalary));
      return;
    }
    if (next === user.monthlySalary) return;
    setSaving(true);
    try {
      await updateUserMonthlySalary(user.id, next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      inputMode="numeric"
      placeholder="未設定"
      title="月薪(元)。人力表裡指到這個人的名額,人力預算用這個月薪算;實際工時成本則是時薪有填的話以時薪為準。"
      className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-50"
    />
  );
}

function SortableUserRow({
  user,
  units,
  supervisorOptions,
  depth,
  uploading,
  onAvatarClick,
  onEdit,
  onDelete,
  onResetPassword,
  onUnlock,
}: {
  user: UserRow;
  /** 公司組織單位,照系統設定裡排好的順序。 */
  units: OrgUnit[];
  /** 誰可以當這個人的主管 —— 已經去掉他自己和他底下的人。 */
  supervisorOptions: UserRow[];
  /** 他在組織圖的第幾階:頭上沒有主管是第 1 階。 */
  depth: number;
  uploading: boolean;
  onAvatarClick: (userId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onResetPassword: () => void;
  onUnlock: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: user.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const isLocked = !!user.lockedUntil && new Date(user.lockedUntil) > new Date();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid ${ROW_GRID} items-center gap-2 border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5 text-sm last:border-b-0`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-neutral-300 dark:text-neutral-600 hover:text-neutral-500 dark:hover:text-neutral-400"
        aria-label="拖曳排序"
      >
        <GripVertical size={14} />
      </button>
      <button
        type="button"
        onClick={() => onAvatarClick(user.id)}
        disabled={uploading}
        className="shrink-0 rounded-full outline-none ring-blue-400 hover:ring-2 disabled:opacity-50"
        aria-label="上傳頭像"
        title="上傳頭像"
      >
        <Avatar name={user.name} avatarUrl={user.avatarUrl} size={32} />
      </button>
      <span className="flex min-w-0 items-center gap-1 truncate text-neutral-800 dark:text-neutral-100">
        {user.name}
        {user.timesheetNoApproval && (
          <span
            className="shrink-0 rounded bg-green-50 px-1 py-0.5 text-[10px] text-green-700 dark:bg-green-950 dark:text-green-300"
            title="工時免審核:登記的工時直接生效"
          >
            免審核
          </span>
        )}
        {isLocked && (
          <Lock size={12} className="shrink-0 text-red-500" aria-label="帳號已鎖定" />
        )}
      </span>
      <span className="truncate text-neutral-500 dark:text-neutral-400">{user.email}</span>
      <span className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
        {roleLabel(user.role)}
        {depth > 1 && (
          <span className="rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            第 {depth} 階
          </span>
        )}
      </span>
      <span className="text-neutral-400 dark:text-neutral-500">
        {new Date(user.createdAt).toLocaleDateString("zh-TW")}
      </span>
      <select
        value={user.discipline ?? ""}
        onChange={(e) => updateUserDiscipline(user.id, (e.target.value || null) as Discipline | null)}
        className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-1 text-xs outline-none focus:border-blue-500"
      >
        <option value="">未設定</option>
        {units.map(({ code: d }) => (
          <option key={d} value={d}>
            {unitLabel(units, d)}
          </option>
        ))}
      </select>
      <SalaryInput user={user} />
      <RateInput user={user} />
      <UserSelect
        users={supervisorOptions}
        value={user.supervisorId ?? ""}
        onChange={(id) => updateUserSupervisor(user.id, id || null)}
        disabled={!!user.orgNodeId}
        title={user.orgNodeId ? "這個人掛在組織架構圖上,所屬主管由架構圖決定(到「組織架構圖」修改)" : undefined}
        emptyLabel="未設定"
        className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500"
      />
      <span className="flex items-center justify-end gap-2">
        {isLocked && (
          <button
            type="button"
            onClick={onUnlock}
            className="text-neutral-400 dark:text-neutral-500 hover:text-green-600"
            aria-label="解除帳號鎖定"
            title="解除鎖定"
          >
            <Unlock size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onResetPassword}
          className="text-neutral-400 dark:text-neutral-500 hover:text-blue-600"
          aria-label="重設密碼"
          title="重設密碼"
        >
          <KeyRound size={14} />
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="text-neutral-400 dark:text-neutral-500 hover:text-blue-600"
          aria-label="編輯使用者"
          title="編輯"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-neutral-400 dark:text-neutral-500 hover:text-red-600"
          aria-label="刪除使用者"
          title="刪除"
        >
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  );
}

export function UserManagement({
  users,
  units,
  currentUserId,
}: {
  users: UserRow[];
  units: OrgUnit[];
  currentUserId: string;
}) {
  const [prevUsers, setPrevUsers] = useState(users);
  const [order, setOrder] = useState(() => users.map((u) => u.id));
  if (users !== prevUsers) {
    setPrevUsers(users);
    setOrder(users.map((u) => u.id));
  }
  const usersById = new Map(users.map((u) => [u.id, u]));
  const orderedUsers = order
    .map((id) => usersById.get(id))
    .filter((u): u is UserRow => u !== undefined);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("MEMBER");
  const [supervisorId, setSupervisorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarTargetId, setAvatarTargetId] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("MEMBER");
  const [editSupervisorId, setEditSupervisorId] = useState("");
  const [editCanViewAll, setEditCanViewAll] = useState(false);
  const [editNoApproval, setEditNoApproval] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { confirm } = useDialogs();

  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const supervisors = users.filter((u) => u.role === "SUPERVISOR" || u.role === "ADMIN");

  /**
   * 三階以上開始有一種兩階時不可能出現的錯:把上層指給自己底下的人,
   * 整條鏈就繞成一圈。伺服器端會擋,但選單裡根本不該出現這些人。
   */
  function supervisorsFor(userId: string): UserRow[] {
    const below = subordinateIds(users, userId);
    return supervisors.filter((s) => s.id !== userId && !below.has(s.id));
  }

  function handleAvatarClick(userId: string) {
    setAvatarTargetId(userId);
    fileInputRef.current?.click();
  }

  async function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !avatarTargetId) return;
    setUploadingId(avatarTargetId);
    setAvatarError(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await updateUserAvatar(avatarTargetId, dataUrl);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "上傳頭像失敗");
    } finally {
      setUploadingId(null);
      setAvatarTargetId(null);
    }
  }

  function reset() {
    setName("");
    setEmail("");
    setPassword("");
    setRole("MEMBER");
    setSupervisorId("");
    setError(null);
  }

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      await createUser(name, email, password, role, supervisorId || null);
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增失敗");
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(user: UserRow) {
    setEditTarget(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditSupervisorId(user.supervisorId ?? "");
    setEditCanViewAll(user.canViewAllTimesheets);
    setEditNoApproval(user.timesheetNoApproval);
    setEditError(null);
  }

  async function handleEditSave() {
    if (!editTarget) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await updateUser(editTarget.id, editName, editEmail, editRole, editSupervisorId || null);
      // 這個權限只在「主管」身上有意思:改成別的角色時順便收回,不留一個沒人看得到的旗標。
      const nextCanViewAll = editRole === "SUPERVISOR" && editCanViewAll;
      if (nextCanViewAll !== editTarget.canViewAllTimesheets) {
        await updateUserTimesheetAccess(editTarget.id, nextCanViewAll);
      }
      if (editNoApproval !== editTarget.timesheetNoApproval) {
        await updateUserTimesheetNoApproval(editTarget.id, editNoApproval);
      }
      setEditTarget(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "修改失敗");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(user: UserRow) {
    const ok = await confirm(`確定要刪除使用者「${user.name}」嗎?此操作無法復原。`, {
      title: "刪除使用者",
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    setDeleteError(null);
    try {
      await deleteUser(user.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "刪除失敗");
    }
  }

  function openResetPassword(user: UserRow) {
    setResetTarget(user);
    setResetPasswordValue("");
    setResetError(null);
  }

  async function handleResetPasswordSave() {
    if (!resetTarget) return;
    setResetSubmitting(true);
    setResetError(null);
    try {
      await adminResetUserPassword(resetTarget.id, resetPasswordValue);
      setResetTarget(null);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "重設密碼失敗");
    } finally {
      setResetSubmitting(false);
    }
  }

  async function handleUnlock(user: UserRow) {
    setUnlockError(null);
    try {
      await unlockUser(user.id);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "解除鎖定失敗");
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((ids) => {
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      const next = arrayMove(ids, oldIndex, newIndex);
      reorderUsers(next);
      return next;
    });
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarFileChange}
      />

      {avatarError && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {avatarError}
        </div>
      )}
      {deleteError && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {deleteError}
        </div>
      )}
      {unlockError && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {unlockError}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={14} /> 新增使用者
        </button>
      </div>

      <HScrollPane className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
        <div
          className={`grid ${ROW_GRID} gap-2 border-b border-neutral-100 dark:border-neutral-700 px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400`}
        >
          <span />
          <span>頭像</span>
          <span>姓名</span>
          <span>Email</span>
          <span>角色</span>
          <span>建立時間</span>
          <span>單位</span>
          <span>月薪(元)</span>
          <span>時薪(元)</span>
          <span>所屬主管</span>
          <span />
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {orderedUsers.map((u) => (
              <SortableUserRow
                key={u.id}
                user={u}
                units={units}
                supervisorOptions={supervisorsFor(u.id)}
                depth={orgDepth(users, u.id)}
                uploading={uploadingId === u.id}
                onAvatarClick={handleAvatarClick}
                onEdit={() => openEdit(u)}
                onDelete={() => handleDelete(u)}
                onResetPassword={() => openResetPassword(u)}
                onUnlock={() => handleUnlock(u)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </HScrollPane>

      <Modal
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
        title="新增使用者"
      >
        {error && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="姓名"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密碼(至少 8 個字元)"
            type="password"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="MEMBER">團隊成員</option>
            <option value="SUPERVISOR">主管</option>
            <option value="ADMIN">管理者</option>
          </select>
          {
            <UserSelect users={supervisors} value={supervisorId} onChange={setSupervisorId} emptyLabel="所屬主管(未設定)" className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          }
          <button
            type="button"
            disabled={submitting || !name.trim() || !email.trim() || !password}
            onClick={handleCreate}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "新增中..." : "新增"}
          </button>
        </div>
      </Modal>

      <Modal
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
        title="編輯使用者"
      >
        {editError && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {editError}
          </div>
        )}
        <div className="space-y-3">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="姓名"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            placeholder="Email"
            type="email"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <select
            value={editRole}
            disabled={editTarget?.id === currentUserId}
            onChange={(e) => setEditRole(e.target.value as UserRole)}
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-neutral-100 dark:disabled:bg-neutral-800"
          >
            <option value="MEMBER">團隊成員</option>
            <option value="SUPERVISOR">主管</option>
            <option value="ADMIN">管理者</option>
          </select>
          <UserSelect
            users={editTarget ? supervisorsFor(editTarget.id) : supervisors}
            value={editSupervisorId}
            onChange={setEditSupervisorId}
            emptyLabel="所屬主管(未設定)"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <label className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-200">
            <input
              type="checkbox"
              checked={editNoApproval}
              onChange={(e) => setEditNoApproval(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              工時免審核
              <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                這個人登記的專案工時與對應專案的會議工時直接生效,不用核准。勾選時,目前待審的也一併視為核准。
              </span>
            </span>
          </label>
          {editRole === "SUPERVISOR" && (
            <label className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-200">
              <input
                type="checkbox"
                checked={editCanViewAll}
                onChange={(e) => setEditCanViewAll(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                可以檢視全部成員的工時
                <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                  沒勾的主管只看得到直屬部屬的工時統計。
                </span>
              </span>
            </label>
          )}
          <button
            type="button"
            disabled={editSubmitting || !editName.trim() || !editEmail.trim()}
            onClick={handleEditSave}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {editSubmitting ? "儲存中..." : "儲存"}
          </button>
        </div>
      </Modal>

      <Modal
        open={resetTarget !== null}
        onOpenChange={(o) => {
          if (!o) setResetTarget(null);
        }}
        title={resetTarget ? `重設「${resetTarget.name}」的密碼` : "重設密碼"}
      >
        {resetError && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {resetError}
          </div>
        )}
        <div className="space-y-3">
          <input
            value={resetPasswordValue}
            onChange={(e) => setResetPasswordValue(e.target.value)}
            placeholder="新密碼(至少 8 個字元)"
            type="password"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={resetSubmitting || resetPasswordValue.length < 8}
            onClick={handleResetPasswordSave}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {resetSubmitting ? "重設中..." : "重設密碼"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
