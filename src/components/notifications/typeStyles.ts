/** 通知與「更新記錄」欄共用的標籤:標籤與顏色一起,新增/刪除/修改/指派/留言要能一眼挑出來。 */
export const NOTIFICATION_TYPE_STYLES: Record<string, { label: string; className: string }> = {
  CREATED: { label: "新增", className: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
  DELETED: { label: "刪除", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  UPDATED: { label: "修改", className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  ASSIGNED: { label: "指派", className: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" },
  COMMENTED: { label: "留言", className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  AUTOMATION: { label: "自動化", className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" },
};
