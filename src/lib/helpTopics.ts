/**
 * 「說明與問題回報」按鈕:使用者在哪個畫面,就開使用手冊的哪一章。純函式,不碰畫面與資料庫。
 *
 * 錨點跟手冊網頁版一致:章是 ch-編號,小節是 s-編號(11.3b → s-11-3b),見 manual.ts。
 * helpTopics.test.ts 會拿真的手冊檢查每一個錨點都還在——手冊改章節編號,這裡沒跟著改,測試會擋下來。
 */

export type HelpTopic = {
  /** 畫面的名稱,顯示在按鈕上,也跟著回報一起存。 */
  label: string;
  /** 手冊的錨點(ch-9、s-9-6);空字串 = 手冊首頁。 */
  anchor: string;
  /** 在只有管理者看得到的章節:一般同仁手冊上沒有那一章,退回手冊首頁。 */
  adminOnly?: boolean;
};

/** 看板上的分頁(BoardView 的 view)。 */
const BOARD_VIEWS: Record<string, HelpTopic> = {
  table: { label: "表格視圖", anchor: "ch-4" },
  kanban: { label: "看板(Kanban)視圖", anchor: "ch-8" },
  gantt: { label: "甘特圖", anchor: "ch-9" },
  report: { label: "報表", anchor: "ch-10" },
  risks: { label: "風險與議題", anchor: "ch-11" },
  issues: { label: "從 MantisBT 同步問題", anchor: "s-11-5" },
  gates: { label: "階段閘門", anchor: "ch-12" },
  changes: { label: "變更管理", anchor: "ch-13" },
  budget: { label: "預算", anchor: "ch-14" },
};

/**
 * 對話視窗(Modal)自己的說明:視窗開著的時候,視窗以外的畫面(包含右下角的「?」)點不到,
 * 所以這些視窗的標題列自己放一個「?」直接開手冊。
 */
export const MODAL_HELP = {
  itemCard: { label: "項目卡片", anchor: "ch-5" },
  assignment: { label: "點長條:人員分配視窗", anchor: "s-9-6" },
} as const satisfies Record<string, HelpTopic>;

const BOARD_PREFIX = "board:";

/** 路徑 → 主題,長的前綴排前面。 */
const ROUTES: [prefix: string, topic: HelpTopic][] = [
  ["/dashboard/project/", { label: "專案儀表板", anchor: "s-16-1" }],
  ["/dashboard", { label: "儀表板", anchor: "ch-16" }],
  ["/boards", { label: "看板的基本概念", anchor: "ch-3" }],
  ["/reports", { label: "週報", anchor: "ch-19" }],
  ["/updates", { label: "更新記錄頁", anchor: "s-1-6" }],
  ["/chat", { label: "對話", anchor: "s-1-7" }],
  ["/timesheet", { label: "工時", anchor: "ch-17" }],
  ["/approvals", { label: "待我審核與請假", anchor: "ch-18" }],
  ["/programs", { label: "專案群組", anchor: "s-20-2" }],
  ["/search", { label: "搜尋", anchor: "s-20-1" }],
  ["/data-export", { label: "資料備份(每個看板的 CSV)", anchor: "s-20-3" }],
  ["/group-roles", { label: "分組角色", anchor: "ch-2" }],
  ["/org-chart", { label: "組織架構圖", anchor: "s-21-1b", adminOnly: true }],
  ["/users", { label: "使用者管理", anchor: "s-21-1", adminOnly: true }],
  ["/audit", { label: "稽核軌跡", anchor: "s-21-2", adminOnly: true }],
  ["/feedback", { label: "使用者回報", anchor: "s-21-2b", adminOnly: true }],
  ["/settings", { label: "系統設定", anchor: "s-21-3", adminOnly: true }],
  ["/manual", { label: "使用手冊", anchor: "" }],
];

const FALLBACK: HelpTopic = { label: "快速開始", anchor: "ch-1" };

const startsWithSegment = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);

/**
 * 這個畫面該開手冊的哪一章。hint 是畫面自己登記的(看板現在在哪個分頁:board:gantt…),
 * 路徑本身看不出來的時候用——看板的分頁切換不會改網址。
 */
export function helpTopicFor(pathname: string, hint: string | null | undefined, isAdmin: boolean): HelpTopic {
  const found = resolve(pathname, hint);
  // 一般同仁的手冊沒有「管理者功能」那一章,連到不存在的錨點等於沒反應:退回手冊首頁。
  return found.adminOnly && !isAdmin ? { label: found.label, anchor: "" } : found;
}

function resolve(pathname: string, hint: string | null | undefined): HelpTopic {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  const route = ROUTES.find(([prefix]) => startsWithSegment(path, prefix));
  if (route && route[0] === "/boards" && hint?.startsWith(BOARD_PREFIX)) {
    return BOARD_VIEWS[hint.slice(BOARD_PREFIX.length)] ?? BOARD_VIEWS.table;
  }
  // 看板頁沒有登記分頁(還沒載入好)就當表格:看板的預設分頁。
  if (route && route[0] === "/boards" && /^\/boards\/[^/]+/.test(path)) return BOARD_VIEWS.table;
  return route?.[1] ?? FALLBACK;
}

/** 手冊網頁的連結:有錨點就跳到那一章 / 小節。 */
export function manualHref(anchor: string): string {
  return anchor ? `/manual#${anchor}` : "/manual";
}

/** 所有會用到的錨點,給測試對照真的手冊。 */
export function allHelpAnchors(): string[] {
  const topics = [...Object.values(BOARD_VIEWS), ...Object.values(MODAL_HELP), ...ROUTES.map(([, t]) => t), FALLBACK];
  return [...new Set(topics.map((t) => t.anchor).filter(Boolean))];
}
