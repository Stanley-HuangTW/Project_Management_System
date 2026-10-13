/**
 * 儀表板「看板篩選」:可以選好幾個看板,而且記住上次選的。純邏輯,不碰 React / Prisma / cookie。
 *
 * 記在 cookie 裡(伺服器端畫儀表板時要用它決定算哪些看板,所以不能只放 localStorage——
 * 那樣要等頁面載入後再跳一次才套得上)。一個瀏覽器記一份,跟「工作量總覽」等儀表板偏好同樣是每個瀏覽器各自的設定。
 */

export const DASHBOARD_BOARD_COOKIE = "dashboard_boards";

function unique(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

/**
 * 網址上的 ?board=:沒有這個參數是 null(用記住的);有的話是清單,空字串就是空清單(全部看板)。
 * 可以重複(?board=a&board=b)也可以逗號隔開(?board=a,b)。
 */
export function parseBoardParam(value: string | string[] | undefined): string[] | null {
  if (value === undefined) return null;
  return unique((Array.isArray(value) ? value : [value]).flatMap((v) => v.split(",")));
}

/** cookie 的值:「使用者 id:看板 id,看板 id」。帶使用者 id,同一個瀏覽器換人登入不會套到別人的選擇。 */
export function encodeBoardCookie(userId: string, boardIds: string[]): string {
  return `${userId}:${unique(boardIds).join(",")}`;
}

/** 讀回 cookie;壞掉的值、別人記的,都當作沒有記。 */
export function decodeBoardCookie(userId: string, raw: string | undefined): string[] {
  if (!raw) return [];
  const at = raw.indexOf(":");
  if (at < 0 || raw.slice(0, at) !== userId) return [];
  return unique(raw.slice(at + 1).split(","));
}

/**
 * 實際要看的看板。網址有指定就用網址(舊的書籤、分享的連結),沒有就用記住的;
 * 只留下現在還存在、這個人看得到的(看板被刪、被收回權限都不會害儀表板變空白)。
 * 空陣列 = 全部看板。
 */
export function resolveBoardFilter(args: {
  urlIds: string[] | null;
  savedIds: string[];
  accessibleIds: string[];
}): string[] {
  const accessible = new Set(args.accessibleIds);
  return (args.urlIds ?? args.savedIds).filter((id) => accessible.has(id));
}

/** 下拉選單按鈕上的字:沒選 = 全部看板;選一個寫名字;選多個寫個數。 */
export function boardFilterSummary(selectedIds: string[], boards: { id: string; name: string }[]): string {
  const chosen = boards.filter((b) => selectedIds.includes(b.id));
  if (chosen.length === 0) return "全部看板";
  if (chosen.length === 1) return chosen[0].name;
  return `${chosen.length} 個看板`;
}
