/**
 * 「選取元素」送出的位置資訊:畫面上選到的那個元素是什麼、在哪裡,加上瀏覽器的大小——給管理者交給
 * Claude Code 除錯用。純函式,不碰 DOM 與資料庫:畫面那一端(components/help/pickElement.ts)抓,
 * 這裡負責檢查與裁短(寫進資料庫、顯示在管理者頁面的東西要先乾淨)和組出給 Claude Code 的提示。
 */

export type PickedElement = {
  /** 標籤名稱,小寫(button、div…)。 */
  tag: string;
  /** 給人看的名稱:aria-label / title / 文字 / placeholder 挑第一個有值的。 */
  label: string;
  /** 元素裡的可見文字(空白收成一格)。 */
  text: string;
  /** 能定位到它的 CSS selector。 */
  selector: string;
  /** id、role、data-*、aria-*、name、type、placeholder、title、href(站內路徑)。 */
  attrs: Record<string, string>;
  classes: string;
  /** 元素的 HTML(裁短)。 */
  html: string;
  /** 由內到外的上層元素,每個寫成 tag#id.class[data-x]。 */
  ancestors: string[];
  /** 在視窗裡的位置與大小(px)。 */
  rect: { x: number; y: number; width: number; height: number };
};

export type FeedbackContext = {
  element?: PickedElement;
  viewport?: { width: number; height: number; dpr: number };
  userAgent?: string;
  /** 看板現在在哪個分頁(board:gantt…)。 */
  hint?: string;
};

const LIMITS = {
  tag: 24,
  label: 60,
  text: 200,
  selector: 300,
  attrKey: 40,
  attrValue: 80,
  attrs: 14,
  classes: 300,
  html: 1500,
  ancestor: 120,
  ancestors: 8,
  userAgent: 200,
  hint: 40,
} as const;

const oneLine = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const coord = (value: unknown): number => {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(-100_000, Math.min(100_000, n));
};

/** 來自畫面的東西都不信任:只收預期的欄位、型別不對就丟掉、字串一律裁短。回傳 null = 沒有可用的資訊。 */
export function normalizeContext(raw: unknown): FeedbackContext | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const out: FeedbackContext = {};

  const el = input.element;
  if (el && typeof el === "object") {
    const e = el as Record<string, unknown>;
    const tag = oneLine(e.tag, LIMITS.tag).toLowerCase();
    if (/^[a-z][a-z0-9-]*$/.test(tag)) {
      const attrs: Record<string, string> = {};
      if (e.attrs && typeof e.attrs === "object") {
        for (const [key, value] of Object.entries(e.attrs as Record<string, unknown>)) {
          if (Object.keys(attrs).length >= LIMITS.attrs) break;
          if (key.length <= LIMITS.attrKey && /^[a-zA-Z][\w:-]*$/.test(key) && typeof value === "string") {
            attrs[key] = oneLine(value, LIMITS.attrValue);
          }
        }
      }
      const rect = (e.rect && typeof e.rect === "object" ? e.rect : {}) as Record<string, unknown>;
      out.element = {
        tag,
        label: oneLine(e.label, LIMITS.label),
        text: oneLine(e.text, LIMITS.text),
        selector: oneLine(e.selector, LIMITS.selector),
        attrs,
        classes: oneLine(e.classes, LIMITS.classes),
        // HTML 片段保留換行與縮排(讀起來才像程式碼),只裁短。
        html: typeof e.html === "string" ? e.html.slice(0, LIMITS.html) : "",
        ancestors: Array.isArray(e.ancestors)
          ? e.ancestors.slice(0, LIMITS.ancestors).map((a) => oneLine(a, LIMITS.ancestor)).filter(Boolean)
          : [],
        rect: { x: coord(rect.x), y: coord(rect.y), width: coord(rect.width), height: coord(rect.height) },
      };
    }
  }

  const vp = input.viewport;
  if (vp && typeof vp === "object") {
    const v = vp as Record<string, unknown>;
    const dpr = typeof v.dpr === "number" && Number.isFinite(v.dpr) ? Math.round(Math.max(0.5, Math.min(8, v.dpr)) * 100) / 100 : 1;
    out.viewport = { width: Math.max(0, coord(v.width)), height: Math.max(0, coord(v.height)), dpr };
  }
  const userAgent = oneLine(input.userAgent, LIMITS.userAgent);
  if (userAgent) out.userAgent = userAgent;
  const hint = oneLine(input.hint, LIMITS.hint);
  if (hint) out.hint = hint;

  return Object.keys(out).length > 0 ? out : null;
}

/** 管理者清單上這個元素的簡短名稱,例如「按鈕「新增項目」」;沒選元素就是 null。 */
export function elementSummary(context: FeedbackContext | null | undefined): string | null {
  const el = context?.element;
  if (!el) return null;
  return el.label ? `<${el.tag}>「${el.label}」` : `<${el.tag}>`;
}

export type DebugPromptInput = {
  id: string;
  userName: string;
  userEmail: string;
  /** 台北時間,YYYY-MM-DD HH:mm。 */
  createdAt: string;
  pageLabel: string;
  path: string;
  manualAnchor: string;
  message: string;
  context: FeedbackContext | null;
};

const code = (value: string) => "`" + value.replace(/`/g, "'") + "`";

/**
 * 管理者按「複製給 Claude Code」:一則回報組成一段可以直接貼給 Claude Code 的說明——誰在哪個畫面
 * 選了哪個元素、說了什麼,加上怎麼用這些資訊在原始碼裡找到它。
 */
export function debugPrompt(r: DebugPromptInput): string {
  const lines: string[] = [`## 使用者回報 ${r.id}`, ""];
  lines.push(`- 回報人:${r.userName}(${r.userEmail})`);
  lines.push(`- 時間:${r.createdAt}(台北時間)`);
  lines.push(`- 畫面:${r.pageLabel}`, `- 網址:${code(r.path)}`);
  if (r.manualAnchor) lines.push(`- 對應的手冊章節:${r.manualAnchor}`);
  const ctx = r.context;
  if (ctx?.hint) lines.push(`- 看板分頁:${ctx.hint}`);
  if (ctx?.viewport) lines.push(`- 瀏覽器視窗:${ctx.viewport.width}×${ctx.viewport.height}(縮放 ${ctx.viewport.dpr})`);
  if (ctx?.userAgent) lines.push(`- 瀏覽器:${ctx.userAgent}`);

  lines.push("", "### 使用者說", "", r.message.trim());

  const el = ctx?.element;
  if (el) {
    lines.push("", "### 使用者選取的元素", "");
    lines.push(`- 標籤:${code(`<${el.tag}>`)}`);
    if (el.text) lines.push(`- 畫面上的文字:「${el.text}」`);
    if (el.selector) lines.push(`- selector:${code(el.selector)}`);
    const attrs = Object.entries(el.attrs);
    if (attrs.length > 0) lines.push(`- 屬性:${attrs.map(([k, v]) => code(v ? `${k}="${v}"` : k)).join("、")}`);
    if (el.classes) lines.push(`- class:${code(el.classes)}`);
    if (el.ancestors.length > 0) lines.push(`- 上層(由內到外):${el.ancestors.map(code).join(" ← ")}`);
    lines.push(`- 在視窗裡的位置:x=${el.rect.x}、y=${el.rect.y},${el.rect.width}×${el.rect.height}`);
    if (el.html) lines.push("", "```html", el.html, "```");
    lines.push(
      "",
      "### 怎麼找原始碼",
      "",
      "屬性名稱(例如 `data-…`)、畫面上的中文文字與 class 都是原始碼裡的字面值,可以直接拿來在 `src/` 搜尋。" +
        "請先找到這個元素對應的元件,判斷使用者說的問題是什麼原因,再提出修正;不確定的地方先問。"
    );
  } else {
    lines.push("", "(這則回報沒有選取元素,只有上面的畫面與說明。)");
  }
  return lines.join("\n");
}
