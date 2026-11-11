import { DASHBOARD_SECTIONS } from "@/lib/dashboardSections";

/**
 * 儀表板的子類(分頁):每個人自己建、自己把區塊歸到某個子類,存在 User.dashboardTabs。
 * 儀表板上方永遠有一個「全部」分頁,看到所有區塊;子類分頁只看歸給它的區塊。
 * 一個區塊最多歸一個子類;沒歸類的只出現在「全部」。純資料與純函式,不碰畫面與資料庫。
 */

export type DashboardTab = { id: string; name: string; sections: string[] };

/** 名稱欄位的建議選項(也可以自己輸入)。 */
export const PRESET_TAB_NAMES = ["個人", "團隊", "樣機"] as const;

export const MAX_DASHBOARD_TABS = 8;
export const MAX_TAB_NAME = 12;

const KNOWN_SECTION_IDS: ReadonlySet<string> = new Set(DASHBOARD_SECTIONS.map((s) => s.id));
const TAB_ID_RE = /^[a-z0-9]{4,16}$/;

/** 新子類的代號。 */
export function newTabId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

/**
 * 存進資料庫、或從資料庫讀出來之前的清理:格式不對的略過,名稱去空白並截短、不重複(忽略大小寫),
 * 區塊只留認得的 id、且同一個區塊只留在最先出現的那個子類,最多 MAX_DASHBOARD_TABS 個。
 */
export function sanitizeDashboardTabs(raw: unknown): DashboardTab[] {
  if (!Array.isArray(raw)) return [];
  const out: DashboardTab[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const claimed = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_DASHBOARD_TABS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const name = (typeof r.name === "string" ? r.name : "").trim().slice(0, MAX_TAB_NAME);
    if (!TAB_ID_RE.test(id) || seenIds.has(id) || !name || seenNames.has(name.toLowerCase())) continue;
    seenIds.add(id);
    seenNames.add(name.toLowerCase());
    const sections: string[] = [];
    for (const s of Array.isArray(r.sections) ? r.sections : []) {
      if (typeof s !== "string" || !KNOWN_SECTION_IDS.has(s) || claimed.has(s)) continue;
      claimed.add(s);
      sections.push(s);
    }
    out.push({ id, name, sections });
  }
  return out;
}

/** 目前選的分頁(網址 ?tab=):不存在、或沒選就是「全部」(null)。 */
export function resolveActiveTab(tabs: readonly DashboardTab[], param: string | undefined): DashboardTab | null {
  return tabs.find((t) => t.id === param) ?? null;
}

/** 這個分頁要顯示哪些區塊;「全部」(null)= 不限制。 */
export function visibleSectionIds(tab: DashboardTab | null): ReadonlySet<string> | null {
  return tab ? new Set(tab.sections) : null;
}

/** 把區塊歸到某個子類(tabId = null 表示不歸類);從原本的子類拿掉。 */
export function assignSection(tabs: readonly DashboardTab[], sectionId: string, tabId: string | null): DashboardTab[] {
  return tabs.map((t) => {
    const without = t.sections.filter((s) => s !== sectionId);
    return { ...t, sections: t.id === tabId ? [...without, sectionId] : without };
  });
}

/** 區塊現在歸在哪個子類(沒有 = null)。 */
export function tabOfSection(tabs: readonly DashboardTab[], sectionId: string): string | null {
  return tabs.find((t) => t.sections.includes(sectionId))?.id ?? null;
}
