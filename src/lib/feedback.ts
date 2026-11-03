/**
 * 使用者問題回報:送出的內容怎麼檢查、管理者頁的 CSV 怎麼排。純函式,不碰資料庫。
 */

export const FEEDBACK_MAX_LENGTH = 2000;
/** 一個人一天最多送幾則(擋手滑連按與灌水,不是限制正常使用)。 */
export const FEEDBACK_DAILY_LIMIT = 20;

export type FeedbackInput = {
  message: string;
  /** 送出時的畫面網址(路徑與查詢字串)。 */
  path: string;
  pageLabel: string;
  /** 手冊錨點(ch-9、s-9-6);空字串 = 手冊首頁。 */
  manualAnchor: string;
};

const MAX_PATH = 500;
const MAX_LABEL = 60;
const ANCHOR_RE = /^(?:ch|s)-[a-z0-9-]{1,20}$/;

/**
 * 檢查使用者送來的回報。畫面帶來的網址、畫面名稱與錨點都不信任:網址一定是站內路徑,
 * 錨點只認手冊的寫法,其餘裁短——寫進資料庫、之後顯示在管理者頁面上的東西要先乾淨。
 */
export function normalizeFeedback(input: Partial<FeedbackInput>): { error: string } | { value: FeedbackInput } {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) return { error: "請先寫下你的問題或想說的話" };
  if (message.length > FEEDBACK_MAX_LENGTH) return { error: `內容太長了(上限 ${FEEDBACK_MAX_LENGTH} 字,現在 ${message.length} 字)` };

  const rawPath = typeof input.path === "string" ? input.path.trim() : "";
  // 只收站內的路徑:// 開頭是別的網站,不是站內。
  const path = rawPath.startsWith("/") && !rawPath.startsWith("//") ? rawPath.slice(0, MAX_PATH) : "/";
  const pageLabel = (typeof input.pageLabel === "string" ? input.pageLabel.trim() : "").slice(0, MAX_LABEL) || "(未知畫面)";
  const anchor = typeof input.manualAnchor === "string" ? input.manualAnchor.trim() : "";
  return { value: { message, path, pageLabel, manualAnchor: ANCHOR_RE.test(anchor) ? anchor : "" } };
}

export type FeedbackCsvRow = {
  createdAt: string;
  userName: string;
  userEmail: string;
  pageLabel: string;
  path: string;
  manualAnchor: string;
  message: string;
  status: "OPEN" | "RESOLVED";
  adminNote: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
};

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

export const FEEDBACK_STATUS_LABELS = { OPEN: "未處理", RESOLVED: "已處理" } as const;

/** 回報清單轉成 CSV(逗號分隔,每格用雙引號包起來,內容裡的雙引號與換行都保留)。給 Excel 開要在前面加 BOM,由下載的那一端加。 */
export function feedbackCsv(rows: FeedbackCsvRow[]): string {
  const header = ["送出時間", "回報人", "Email", "畫面", "網址", "手冊章節", "內容", "狀態", "處理說明", "處理時間", "處理人"];
  const lines = rows.map((r) =>
    [
      r.createdAt,
      r.userName,
      r.userEmail,
      r.pageLabel,
      r.path,
      r.manualAnchor,
      r.message,
      FEEDBACK_STATUS_LABELS[r.status],
      r.adminNote ?? "",
      r.resolvedAt ?? "",
      r.resolvedByName ?? "",
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}
