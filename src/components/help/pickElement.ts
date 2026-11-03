import type { PickedElement } from "@/lib/feedbackContext";

/**
 * 「選取元素」在瀏覽器這一端的工作:滑鼠指到的元素要選哪一個、把它描述成一包資訊(標籤、文字、selector、
 * 上層鏈、HTML 片段…)。這包資訊給管理者交給 Claude Code 除錯用——Claude Code 看不到使用者的畫面,
 * 只能靠這些字面值(data-* 標記、畫面上的中文文字、class)在原始碼裡搜尋。
 *
 * 輸入框的內容(value)一律不收:可能是密碼或別人看不到的東西。檢查與裁短由伺服器那一端(normalizeContext)再做一次。
 */

const INTERACTIVE = "button, a[href], [role='button'], [role='tab'], [role='menuitem'], input, select, textarea, summary, label";

/** 每次畫面更新就會變的 data 標記(Radix 的狀態…),不能拿來認元素。 */
const VOLATILE_DATA = /^data-(state|orientation|side|align|highlighted|disabled|selected|placeholder|slot|scroll-locked|aria-hidden|doc-mark|picker-ui|radix-.*)$/;

const KEEP_ATTRS = new Set(["role", "name", "type", "placeholder", "title", "alt", "for", "href", "target"]);

/** 手寫的 id 才穩定;React 的 useId(:r1:)與 Radix 自己生的不算。 */
const stableId = (id: string): boolean => /^[A-Za-z][\w-]{0,40}$/.test(id) && !/^(radix|headlessui)/i.test(id);

const dataNames = (el: Element): string[] =>
  el.getAttributeNames().filter((n) => n.startsWith("data-") && !VOLATILE_DATA.test(n));

/**
 * 滑鼠指到圖示、文字這些小東西時,選包著它們的按鈕 / 連結——使用者想問的通常是「這個按鈕」,不是裡面的 <span>。
 * 沒有包著它們的可操作元素就選它自己。
 */
export function pickTarget(el: Element): Element {
  const base = el.closest("svg") ?? el;
  return base.closest(INTERACTIVE) ?? base;
}

function segment(el: Element): { text: string; anchored: boolean } {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute("id");
  if (id && stableId(id)) return { text: `${tag}#${CSS.escape(id)}`, anchored: true };

  const hook = dataNames(el)[0];
  let text = hook ? `${tag}[${hook}]` : tag;
  const siblings = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName) : [];
  // 同一排的好幾個兄弟帶著同一個標記(清單的每一列):光靠標記分不出來,要加第幾個。
  const ambiguous = hook ? siblings.filter((c) => c.hasAttribute(hook)).length > 1 : siblings.length > 1;
  if (ambiguous) text += `:nth-of-type(${siblings.indexOf(el) + 1})`;
  return { text, anchored: false };
}

/** 能唯一定位到這個元素的最短 selector(由它往上加層,直到整個畫面只有一個符合)。 */
export function selectorOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && cur !== document.body && cur !== document.documentElement && depth < 8; depth++) {
    const seg = segment(cur);
    parts.unshift(seg.text);
    const candidate = parts.join(" > ");
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    } catch {
      /* 不合法的 selector:繼續往上加層 */
    }
    if (seg.anchored) break;
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

/** 上層元素的簡短寫法:tag#id[data-x][role=…],什麼標記都沒有的才補前兩個 class。 */
function describeNode(el: Element): string {
  const id = el.getAttribute("id");
  const hooks = dataNames(el).slice(0, 3);
  const role = el.getAttribute("role");
  let out = el.tagName.toLowerCase() + (id && stableId(id) ? `#${id}` : "") + hooks.map((h) => `[${h}]`).join("") + (role ? `[role=${role}]` : "");
  if (hooks.length === 0 && !(id && stableId(id))) {
    const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2);
    out += classes.map((c) => `.${c}`).join("");
  }
  return out.slice(0, 120);
}

function attrsOf(el: Element): Record<string, string> {
  const data: Record<string, string> = {};
  const other: Record<string, string> = {};
  for (const name of el.getAttributeNames()) {
    const value = el.getAttribute(name) ?? "";
    if (name === "id") {
      if (stableId(value)) other.id = value;
    } else if (name.startsWith("data-")) {
      if (!VOLATILE_DATA.test(name)) data[name] = value;
    } else if (name.startsWith("aria-") || KEEP_ATTRS.has(name)) {
      if (name === "href") {
        // 站內只留路徑與查詢字串;外部連結不記網址。
        try {
          const u = new URL(value, location.href);
          other.href = u.origin === location.origin ? u.pathname + u.search : "(外部連結)";
        } catch {
          other.href = "";
        }
      } else {
        other[name] = value;
      }
    }
  }
  return { ...data, ...other };
}

const textOf = (el: Element): string => {
  // 輸入框、下拉選單的內容可能是使用者自己打的(密碼…),不當文字收。
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return "";
  return ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
};

function htmlOf(el: Element): string {
  // 內容太多的容器(整張表格、整個甘特圖)不整包複製:只留它自己那一層。
  const big = el.querySelectorAll("*").length > 400;
  const clone = el.cloneNode(!big) as Element;
  if (big) clone.append(document.createComment(" 內容太多,省略 "));
  for (const field of [clone, ...Array.from(clone.querySelectorAll("input, textarea, select"))]) {
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(field.tagName)) continue;
    field.removeAttribute("value");
    if (field.tagName === "TEXTAREA") field.textContent = "";
  }
  clone.querySelectorAll("[data-picker-ui]").forEach((n) => n.remove());
  return clone.outerHTML.replace(/></g, ">\n<").slice(0, 1500);
}

/** 給人看的名稱:aria-label、畫面上看得到的文字、title、placeholder 挑第一個有值的(使用者眼裡這個東西叫什麼)。 */
export function labelOf(el: Element): string {
  return (
    el.getAttribute("aria-label") ||
    textOf(el).slice(0, 60) ||
    el.getAttribute("title") ||
    el.getAttribute("placeholder") ||
    el.getAttribute("alt") ||
    el.getAttribute("name") ||
    ""
  ).trim();
}

export function capturePickedElement(el: Element): PickedElement {
  const rect = el.getBoundingClientRect();
  const ancestors: string[] = [];
  for (let cur = el.parentElement; cur && cur !== document.documentElement && ancestors.length < 8; cur = cur.parentElement) {
    ancestors.push(describeNode(cur));
  }
  return {
    tag: el.tagName.toLowerCase(),
    label: labelOf(el),
    text: textOf(el),
    selector: selectorOf(el),
    attrs: attrsOf(el),
    classes: (el.getAttribute("class") ?? "").replace(/\s+/g, " ").trim(),
    html: htmlOf(el),
    ancestors,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

/**
 * 拿選到的元素上的文字去搜尋手冊用的關鍵字(太短搜不出東西就 null)。優先用介面寫死的字(aria-label、title、placeholder),
 * 它們才會出現在手冊裡;畫面上的文字常常是資料(項目名稱…),搜不到東西,放最後。
 */
export function manualQueryOf(el: Element): string | null {
  const raw = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || textOf(el);
  const text = raw.replace(/[「」"'()()::]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
  return text.length >= 2 ? text : null;
}
