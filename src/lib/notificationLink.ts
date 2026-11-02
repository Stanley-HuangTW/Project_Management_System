/**
 * 通知信裡「開啟:網址」要去的地方(站內的相對路徑,寄信時由 appUrl 換成完整網址)。
 * 跟站內通知(鈴鐺)點下去跳到的是同一個地方——鈴鐺的跳轉見 NotificationBell.tsx;
 * 待辦事項的到期提醒用 todoDeadline.ts 的 reminderLink,它多帶了要開哪個分頁。
 * 純函式,不碰資料庫。
 */

/** 工作項:看板上打開那個工作項的項目卡片;tab 是要停在哪個分頁(例如留言就停在「更新」)。 */
export function itemLink(boardId: string, itemId: string, tab?: "updates" | "files" | "links" | "activity" | "card" | "checklist" | "cost"): string {
  return `/boards/${boardId}?highlight=${itemId}${tab ? `&highlightTab=${tab}` : ""}`;
}

/** 風險 / 議題:看板的風險分頁,有 id 就直接開那一筆。 */
export function riskLink(boardId: string, riskId?: string | null): string {
  return `/boards/${boardId}?view=risks${riskId ? `&risk=${riskId}` : ""}`;
}

/** 對話:那間對話(看板頻道、群組、私訊)。 */
export function chatLink(conversationId: string): string {
  return `/chat?c=${conversationId}`;
}
