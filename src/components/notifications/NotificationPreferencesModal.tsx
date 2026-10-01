"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  getMyNotificationPreferences,
  setMyNotificationPreference,
  type NotificationPreferenceRow,
} from "@/lib/actions/notification";
import { NOTIFICATION_TYPE_LABELS as TYPE_LABELS } from "@/lib/notificationTypes";
import type { NotificationType } from "@prisma/client";

/**
 * 個人的通知偏好——每種類型各自決定要不要顯示在站內通知、要不要寄 email。
 * 管理者如果在系統設定把某個類型整個關掉,這裡的勾選就不生效(見
 * notify.ts 的 filterInAppRecipients/notifyEmailIfNeeded),所以沒有特別
 * 標示「已被管理者關閉」——勾了也一樣收不到,这是後端的事,不在這裡重複
 * 判斷,保持這個畫面單純。
 */
export function NotificationPreferencesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<NotificationPreferenceRow[] | null>(null);
  const [savingType, setSavingType] = useState<NotificationType | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getMyNotificationPreferences().then((data) => {
      if (!cancelled) setRows(data);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function toggle(type: NotificationType, patch: { inApp?: boolean; email?: boolean }) {
    setRows((prev) =>
      prev ? prev.map((r) => (r.type === type ? { ...r, ...patch } : r)) : prev
    );
    setSavingType(type);
    try {
      await setMyNotificationPreference(type, patch);
    } finally {
      setSavingType(null);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="通知設定">
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        每種通知各自決定要不要顯示在站內通知鈴鐺、要不要額外寄 email。
      </p>
      {!rows ? (
        <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
          <div className="grid grid-cols-[1fr_5rem_5rem] gap-2 pb-2 text-xs text-neutral-400 dark:text-neutral-500">
            <span>通知類型</span>
            <span className="text-center">站內</span>
            <span className="text-center">Email</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.type}
              className={`grid grid-cols-[1fr_5rem_5rem] items-center gap-2 py-2.5 ${
                savingType === row.type ? "opacity-60" : ""
              }`}
            >
              <span className="text-sm text-neutral-700 dark:text-neutral-100">
                {TYPE_LABELS[row.type]}
              </span>
              <span className="flex justify-center">
                <input
                  type="checkbox"
                  checked={row.inApp}
                  onChange={(e) => toggle(row.type, { inApp: e.target.checked })}
                  className="h-4 w-4 accent-blue-600"
                />
              </span>
              <span className="flex justify-center">
                <input
                  type="checkbox"
                  checked={row.email}
                  onChange={(e) => toggle(row.type, { email: e.target.checked })}
                  className="h-4 w-4 accent-blue-600"
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
