import { applyStoredOrder, sanitizeOrder } from "@/lib/sidebarOrder";

/**
 * 儀表板上的區塊,以及每個人自己排的先後順序。
 *
 * 順序存在 User.dashboardOrder(區塊 id,由上到下),跟側邊欄看板順序同一個做法:
 * 沒排過的人照預設順序;清單裡沒有的區塊(之後新增的)接在最後、維持預設順序;清單裡有、但這個人看不到的
 * (例如只有主管才有的「團隊項目」)直接略過。純資料與純函式,不碰畫面與資料庫,整個測得到。
 */

/** 預設順序,也是設定視窗裡列出來的名稱。 */
export const DASHBOARD_SECTIONS = [
  { id: "budgetAlerts", label: "預算警示" },
  { id: "openRisks", label: "未結案的風險與問題" },
  { id: "projectLeader", label: "專案負責人總覽(Team Leader)" },
  { id: "teamWorkload", label: "工作量總覽" },
  { id: "overAllocation", label: "過度配置" },
  { id: "workloadDetail", label: "成員工作量明細" },
  { id: "boardProgress", label: "看板進度總覽" },
  { id: "dueLists", label: "待辦事項到期清單(逾期 / 本週完成 / 未來 7 天 / 30 天)" },
  { id: "todoDeadlines", label: "工作項目的待辦事項期限" },
  { id: "teamItems", label: "團隊項目(主管)" },
  { id: "myItems", label: "我的項目" },
  { id: "myResourceItems", label: "我的團隊項目(你擔任窗口的資源)" },
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number]["id"];

const KNOWN_IDS: ReadonlySet<string> = new Set(DASHBOARD_SECTIONS.map((s) => s.id));

/** 這些區塊依這個人存的順序排好;沒排過的接在後面。 */
export function orderDashboardSections<T extends { id: string }>(sections: T[], stored: readonly string[]): T[] {
  return applyStoredOrder(sections, stored);
}

/** 存進資料庫前清理:只留認得的區塊 id、去重複。 */
export function sanitizeDashboardOrder(ids: unknown): string[] {
  return sanitizeOrder(ids).filter((id) => KNOWN_IDS.has(id));
}

/** 把 id 這一項往上(-1)或往下(+1)移一格;已經在頭或尾、或不在清單裡就原樣回傳。 */
export function moveSection(ids: readonly string[], id: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
