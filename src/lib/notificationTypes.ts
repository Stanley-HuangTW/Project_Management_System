import type { NotificationType } from "@prisma/client";

/** 固定順序——設定頁面跟通知下拉選單的「每種類型一列」都照這個順序排。
 *  純資料,沒有 server 端的依賴,client component 可以直接 import。 */
export const ALL_NOTIFICATION_TYPES: NotificationType[] = [
  "ASSIGNED",
  "UPDATED",
  "COMMENTED",
  "AUTOMATION",
  "CREATED",
  "DELETED",
];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  ASSIGNED: "指派",
  UPDATED: "修改",
  COMMENTED: "留言",
  AUTOMATION: "自動化規則",
  CREATED: "新增項目",
  DELETED: "刪除項目",
};

/**
 * 一個人沒有特別設定過某種通知類型時用的預設值——跟加入這個偏好功能
 * 之前的既有行為一致:站內通知一律顯示,email 則只有指派與自動化規則
 * 會寄(原本寫死在 notify.ts 的 EMAIL_NOTIFICATION_TYPES 裡的那兩種)。
 */
export const DEFAULT_NOTIFICATION_PREFERENCE: Record<
  NotificationType,
  { inApp: boolean; email: boolean }
> = {
  ASSIGNED: { inApp: true, email: true },
  UPDATED: { inApp: true, email: false },
  COMMENTED: { inApp: true, email: false },
  AUTOMATION: { inApp: true, email: true },
  CREATED: { inApp: true, email: false },
  DELETED: { inApp: true, email: false },
};
