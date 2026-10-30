"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { fileToAvatarDataUrl } from "@/lib/avatarImage";
import { updateOwnAvatar, updateOwnPassword } from "@/lib/actions/user";
import {
  listImpersonationUsers,
  startImpersonation,
  stopImpersonation,
  type ImpersonationUser,
} from "@/lib/actions/impersonate";
import { useTheme } from "@/lib/useTheme";
import { actionErrorMessage, knownErrorMessage } from "@/lib/userError";

export function ProfileModal({
  userName,
  avatarUrl,
  isAdmin,
  impersonating,
  open,
  onOpenChange,
}: {
  userName: string;
  avatarUrl: string | null;
  /** 目前登入的角色是管理者(代操作中顯示的是被檢視者,所以這裡可能是 false)。 */
  isAdmin: boolean;
  /** 管理者正以別人的身分檢視:不能改對方的照片與密碼,可以在這裡退出。 */
  impersonating: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewAvatarUrl, setPreviewAvatarUrl] = useState(avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // 管理者切換使用者視角:下拉選單的使用者名單打開視窗才去抓。
  const canSwitch = isAdmin && !impersonating;
  const [users, setUsers] = useState<ImpersonationUser[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !canSwitch || users) return;
    let cancelled = false;
    (async () => {
      const list = await listImpersonationUsers();
      if (!cancelled) setUsers(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, canSwitch, users]);

  // Resync the preview when the modal is reopened with fresh server data,
  // without fighting an upload already in progress — adjusted during
  // render, not an effect, same pattern used elsewhere in this codebase.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPreviewAvatarUrl(avatarUrl);
      setAvatarError(null);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordError(null);
      setPasswordSuccess(false);
      setSwitchError(null);
    }
  }

  /** 切換、退出之後整頁重新載入:所有畫面都要用新的身分重新取資料。 */
  async function handleSwitch() {
    if (!targetId) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      const result = await startImpersonation(targetId);
      if (result.error) {
        setSwitchError(result.error);
        return;
      }
      window.location.reload();
    } catch (err) {
      setSwitchError(knownErrorMessage(err, "切換失敗"));
    } finally {
      setSwitching(false);
    }
  }

  async function handleStopImpersonation() {
    setSwitching(true);
    try {
      await stopImpersonation();
    } finally {
      window.location.reload();
    }
  }

  async function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setAvatarError(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await updateOwnAvatar(dataUrl);
      setPreviewAvatarUrl(dataUrl);
      router.refresh();
    } catch (err) {
      setAvatarError(actionErrorMessage(err, "上傳頭像失敗"));
    } finally {
      setUploading(false);
    }
  }

  async function handlePasswordChange() {
    setChangingPassword(true);
    setPasswordError(null);
    setPasswordSuccess(false);
    try {
      await updateOwnPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordSuccess(true);
    } catch (err) {
      setPasswordError(actionErrorMessage(err, "更新密碼失敗"));
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="個人資料">
      <div className="mb-5 flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || impersonating}
          className="relative shrink-0 rounded-full outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
          aria-label="更換照片"
        >
          <Avatar name={userName} avatarUrl={previewAvatarUrl} size={64} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarFileChange}
          className="hidden"
        />
        <div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{userName}</p>
          {!impersonating && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-xs text-blue-600 hover:underline disabled:opacity-50"
            >
              {uploading ? "上傳中..." : "更換照片"}
            </button>
          )}
        </div>
      </div>
      {avatarError && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{avatarError}</div>
      )}

      <div className="border-t border-neutral-100 dark:border-neutral-700 pt-4">
        <p className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">外觀主題</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTheme("light")}
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
              theme === "light"
                ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-100"
            }`}
          >
            白色
          </button>
          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
              theme === "dark"
                ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-100"
            }`}
          >
            黑色
          </button>
        </div>
      </div>

      {impersonating && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p>你正以「{userName}」的身分檢視,不能更換對方的照片或密碼。</p>
          <button
            type="button"
            onClick={() => void handleStopImpersonation()}
            disabled={switching}
            className="mt-2 rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
          >
            {switching ? "退出中..." : "退出,回到我自己"}
          </button>
        </div>
      )}

      {!impersonating && (
      <div className="border-t border-neutral-100 dark:border-neutral-700 pt-4 mt-4">
        <p className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">變更密碼</p>
        {passwordError && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{passwordError}</div>
        )}
        {passwordSuccess && (
          <div className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">密碼已更新</div>
        )}
        <div className="space-y-2">
          <input
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="目前密碼"
            type="password"
            autoComplete="current-password"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="新密碼(至少 8 個字元)"
            type="password"
            autoComplete="new-password"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={changingPassword || !currentPassword || newPassword.length < 8}
            onClick={handlePasswordChange}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {changingPassword ? "更新中..." : "更新密碼"}
          </button>
        </div>
      </div>
      )}

      {canSwitch && (
        <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700">
          <p className="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">切換使用者視角(管理者)</p>
          <p className="mb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            以那位使用者的身分看畫面、操作,方便重現他遇到的問題。操作會記進稽核軌跡;改的資料會算在對方名下,觸發的通知與信件會真的寄出;4 小時後自動失效。
          </p>
          {switchError && <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{switchError}</div>}
          <div className="flex gap-2">
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
            >
              <option value="">{users ? "選擇使用者…" : "載入中..."}</option>
              {users?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}({u.email})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!targetId || switching}
              onClick={() => void handleSwitch()}
              className="shrink-0 rounded-md bg-amber-400 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-amber-300 disabled:opacity-50"
            >
              {switching ? "切換中..." : "切換"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
