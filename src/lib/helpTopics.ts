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

/**
 * 「選取元素」選到的地方,比整個畫面更精確的手冊章節:從選到的元素往外找,第一個符合 selector 的就用它。
 * selector 用畫面上已經有的 data-* 標記;沒對到的元素退回整個畫面的章節(helpTopicFor),
 * 另外還可以拿元素上的文字去搜尋手冊。新增標記、或某個區塊值得有自己的章節時,在這裡加一列——
 * helpTopics.test.ts 會檢查錨點都還在手冊裡。越具體的放越前面。
 */
export const ELEMENT_TOPICS: [selector: string, topic: HelpTopic][] = [
  ["[data-gantt-bar]", { label: "甘特圖:拖曳調整時程", anchor: "s-9-3" }],
  ["[data-link-menu], [data-link-dot]", { label: "甘特圖:前置依賴(Pred / Link)", anchor: "s-9-5" }],
  ["[data-gantt-row]", { label: "甘特圖:怎麼看長條", anchor: "s-9-2" }],
  ["[data-kanban-card]", { label: "看板(Kanban)視圖", anchor: "ch-8" }],
  ["[data-risk-todo], [data-risk-todos]", { label: "風險、議題的待辦事項", anchor: "s-11-3b" }],
  ["[data-risk-row]", { label: "風險與議題", anchor: "ch-11" }],
  ["[data-todo-deadlines], [data-todo-deadline-row]", { label: "儀表板:待辦事項期限", anchor: "ch-16" }],
  ["[data-proto-usage], [data-proto-machine], [data-proto-bar]", { label: "儀表板:樣機使用時程", anchor: "ch-16" }],
  ["[data-project-dashboard]", { label: "專案儀表板", anchor: "s-16-1" }],
  ["[data-cell-item], [data-cell-col]", { label: "表格:直接編輯儲存格", anchor: "s-4-2" }],
  ["[data-item-name-button], [data-card-field], [data-todo-row]", { label: "項目卡片", anchor: "ch-5" }],
  ["[data-role-row], [data-member-row], [data-resource-row], [data-board-roles-button], [data-group-roles-button]", { label: "分組角色與看板角色", anchor: "ch-2" }],
  ["[data-budget-viewers], [data-budget-viewer]", { label: "預算金額的可見範圍", anchor: "ch-2" }],
  ["[data-chat-conversation], [data-chat-input], [data-chat-message]", { label: "對話", anchor: "s-1-7" }],
  ["[data-stale-snapshot], [data-last-run], [data-dispatch-info]", { label: "週報", anchor: "ch-19" }],
  ["[data-feedback-list], [data-feedback-row]", { label: "使用者回報", anchor: "s-21-2b", adminOnly: true }],
  ["[data-disk-usage-card]", { label: "系統設定:磁碟空間", anchor: "s-21-3", adminOnly: true }],
  ["[data-handover-section]", { label: "使用者管理:工作交接", anchor: "s-21-1", adminOnly: true }],
  ["[data-org-node]", { label: "組織架構圖", anchor: "s-21-1b" }],
  ["[data-issue-timeline]", { label: "ISSUE TRACKER:進度與解決方案時間軸", anchor: "s-24-3" }],
  ["[data-issue-attachments]", { label: "ISSUE TRACKER:附件與連結", anchor: "s-24-3" }],
  ["[data-issue-filters]", { label: "ISSUE TRACKER:搜尋與篩選", anchor: "s-24-6" }],
  ["[data-issue-pareto]", { label: "ISSUE TRACKER:最常發生的問題統計", anchor: "s-24-6" }],
  ["[data-issue-options]", { label: "ISSUE TRACKER:選項管理", anchor: "s-24-7" }],
  ["[data-issue-import]", { label: "ISSUE TRACKER:Excel 匯入", anchor: "s-24-7" }],
  ["[data-issue-work-hours]", { label: "ISSUE TRACKER:花費工時", anchor: "s-24-4" }],
  ["[data-issue-days]", { label: "ISSUE TRACKER:處理天數", anchor: "s-24-4" }],
  ["[data-issue-lock]", { label: "ISSUE TRACKER:確認完成與鎖定", anchor: "s-24-5" }],
];

const BOARD_PREFIX = "board:";

const ISSUE_CASE_TOPIC: HelpTopic = { label: "ISSUE TRACKER:案件頁", anchor: "s-24-3" };

/** 路徑 → 主題,長的前綴排前面。 */
const ROUTES: [prefix: string, topic: HelpTopic][] = [
  // ISSUE TRACKER(手冊第 24 章)。/issues/<案件> 的案件頁在 resolve() 裡另外處理。
  // ISSUE TRACKER 裡共用的頁面(同一份資料與頁面,說明沿用專案管理系統手冊的章節)。
  ["/issues/users", { label: "使用者管理", anchor: "s-21-1", adminOnly: true }],
  ["/issues/org-chart", { label: "組織架構圖", anchor: "s-21-1b" }],
  ["/issues/timesheet", { label: "工時", anchor: "ch-17" }],
  ["/issues/feedback", { label: "使用者回報", anchor: "s-21-2b", adminOnly: true }],
  ["/issues/manual", { label: "使用手冊", anchor: "" }],
  ["/issues/settings", { label: "ISSUE TRACKER:系統設定", anchor: "s-24-9" }],
  ["/issues/admin", { label: "ISSUE TRACKER:選項管理與 Excel 匯入", anchor: "s-24-7" }],
  ["/issues/stats", { label: "ISSUE TRACKER:各產品統整", anchor: "s-24-6" }],
  ["/issues/new", { label: "ISSUE TRACKER:回報新案件", anchor: "s-24-2" }],
  ["/issues", { label: "ISSUE TRACKER:案件列表", anchor: "s-24-6" }],
  // 登入後的選系統頁與無權限頁:說明在「登入」那一節。
  ["/select-system", { label: "登入與選擇系統", anchor: "s-1-1" }],
  ["/no-access", { label: "登入與選擇系統", anchor: "s-1-1" }],
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
  // /issues/<案件 id>:案件頁(歸屬、解決方案、時間軸、附件、確認完成)。
  if (route && route[0] === "/issues" && /^\/issues\/[^/]+$/.test(path)) return ISSUE_CASE_TOPIC;
  if (route && route[0] === "/boards" && hint?.startsWith(BOARD_PREFIX)) {
    return BOARD_VIEWS[hint.slice(BOARD_PREFIX.length)] ?? BOARD_VIEWS.table;
  }
  // 看板頁沒有登記分頁(還沒載入好)就當表格:看板的預設分頁。
  if (route && route[0] === "/boards" && /^\/boards\/[^/]+/.test(path)) return BOARD_VIEWS.table;
  return route?.[1] ?? FALLBACK;
}

/**
 * 選到的元素對應哪一章:matches(selector) 回答「選到的元素本身或它的上層有沒有符合這個 selector」
 * (畫面那一端用 element.closest)。沒有符合的回 null,呼叫端退回整個畫面的章節。
 */
export function helpTopicForElement(matches: (selector: string) => boolean, isAdmin: boolean): HelpTopic | null {
  for (const [selector, topic] of ELEMENT_TOPICS) {
    if (!matches(selector)) continue;
    return topic.adminOnly && !isAdmin ? { label: topic.label, anchor: "" } : topic;
  }
  return null;
}

/**
 * 目前畫面屬於哪個系統的網址前綴:ISSUE TRACKER 的頁面都在 /issues 底下(手冊也要留在它的外框裡),
 * 其他(專案管理系統)沒有前綴。
 */
export function systemBaseOf(pathname: string): "" | "/issues" {
  return pathname === "/issues" || pathname.startsWith("/issues/") ? "/issues" : "";
}

/** 手冊網頁的連結:有錨點就跳到那一章 / 小節。base 是系統的網址前綴(見 systemBaseOf)。 */
export function manualHref(anchor: string, base: "" | "/issues" = ""): string {
  return anchor ? `${base}/manual#${anchor}` : `${base}/manual`;
}

/** 所有會用到的錨點,給測試對照真的手冊。 */
export function allHelpAnchors(): string[] {
  const topics = [...Object.values(BOARD_VIEWS), ...Object.values(MODAL_HELP), ...ROUTES.map(([, t]) => t), ...ELEMENT_TOPICS.map(([, t]) => t), FALLBACK];
  return [...new Set(topics.map((t) => t.anchor).filter(Boolean))];
}
