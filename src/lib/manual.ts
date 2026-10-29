import { Marked } from "marked";

/**
 * 使用手冊(docs/使用手冊.md)的網頁版:把 Markdown 切成章節、轉成 HTML、依角色過濾、搜尋。純邏輯,不碰檔案與 session。
 *
 * 章節是 `## 12. 標題`;章節標題底下單獨一行 `<!-- admin-only -->` 表示這一章只給管理者看
 * (這行在 PDF 與其他 Markdown 檢視器裡看不到)。`## 目錄` 不用——網頁版自己產生目錄。
 */

/** 標在章節標題底下,表示整章只給管理者看。 */
export const ADMIN_ONLY_MARK = "<!-- admin-only -->";

/** 手冊圖片在網站上的網址前綴(見 api/manual/images)。 */
export const MANUAL_IMAGE_URL = "/api/manual/images/";

export type ManualSection = { id: string; title: string };

export type ManualChapter = {
  /** 網頁上的錨點,例如 ch-11。 */
  id: string;
  number: number;
  title: string;
  adminOnly: boolean;
  /** 章節內容(不含 `## ` 標題行)。 */
  markdown: string;
  /** 章節底下的 `### ` 小節,目錄用。 */
  sections: ManualSection[];
};

export type Manual = {
  title: string;
  /** 適用版本的日期(2026-10-28);寫法不認得就是 null。 */
  version: string | null;
  /** 這一版包含的更新(版本那行括號裡的字);很長,網頁收在摺疊裡。 */
  versionNotes: string | null;
  /** 標題與目錄之間的說明(適用版本、虛構資料的聲明)。 */
  intro: string;
  /** 目錄之後的角色標示說明。 */
  legend: string;
  chapters: ManualChapter[];
};

const CHAPTER_RE = /^##\s+(\d+)\.\s+(.+?)\s*$/;
const ADMIN_MARK_RE = /^<!--\s*admin-only\s*-->[ \t]*$/m;
// `> 適用版本:2026-10-28(含「…」、「…」)`
const VERSION_RE = /^>\s*適用版本[:：]\s*(\d{4}-\d{2}-\d{2})\s*(?:[(（](.*)[)）])?\s*$/;

/** 小節標題的錨點:有編號的用編號(11.3b → s-11-3b),沒有的用文字。 */
export function sectionIdFromText(text: string): string {
  const plain = text.replace(/<[^>]+>/g, "").trim();
  const numbered = /^(\d+(?:\.\d+)*[a-z]?)(?![\p{L}\p{N}])/iu.exec(plain);
  if (numbered) return `s-${numbered[1].toLowerCase().replace(/\./g, "-")}`;
  return `s-${plain.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-")}`;
}

/** 去掉頭尾的空行,以及章節結尾用來分隔下一章的 `---`。 */
function trimBlankEdges(lines: string[]): string[] {
  const blank = (l: string) => l.trim() === "";
  let start = 0;
  let end = lines.length;
  while (start < end && blank(lines[start])) start++;
  while (end > start && (blank(lines[end - 1]) || lines[end - 1].trim() === "---")) end--;
  return lines.slice(start, end);
}

export function parseManual(source: string): Manual {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let title = "使用手冊";
  let version: string | null = null;
  let versionNotes: string | null = null;
  let mode: "intro" | "toc" | "chapter" = "intro";
  let inFence = false;
  const intro: string[] = [];
  const legend: string[] = [];
  const raw: { number: number; title: string; lines: string[] }[] = [];

  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence) {
      if (mode === "intro" && /^#\s+/.test(line)) {
        title = line.replace(/^#\s+/, "").trim();
        continue;
      }
      if (/^##\s+目錄\s*$/.test(line)) {
        mode = "toc";
        continue;
      }
      const chapter = CHAPTER_RE.exec(line);
      if (chapter) {
        raw.push({ number: Number(chapter[1]), title: chapter[2], lines: [] });
        mode = "chapter";
        continue;
      }
    }
    const versionLine = mode === "intro" ? VERSION_RE.exec(line) : null;
    if (versionLine) {
      version = versionLine[1];
      versionNotes = versionLine[2]?.trim() || null;
    } else if (mode === "intro") intro.push(line);
    else if (mode === "toc") {
      // 目錄清單由網頁自己產生;留下角色標示那段說明。
      if (!/^\d+\.\s+\[/.test(line) && line.trim() !== "---") legend.push(line);
    } else raw[raw.length - 1].lines.push(line);
  }

  const chapters: ManualChapter[] = raw.map((r) => {
    let body = r.lines.join("\n");
    const adminOnly = ADMIN_MARK_RE.test(body);
    if (adminOnly) body = body.replace(ADMIN_MARK_RE, "");
    const kept = trimBlankEdges(body.split("\n"));

    const sections: ManualSection[] = [];
    let fenced = false;
    for (const line of kept) {
      if (/^```/.test(line)) fenced = !fenced;
      const h3 = !fenced ? /^###\s+(.+?)\s*$/.exec(line) : null;
      if (h3) sections.push({ id: sectionIdFromText(h3[1]), title: h3[1] });
    }
    return { id: `ch-${r.number}`, number: r.number, title: r.title, adminOnly, markdown: kept.join("\n"), sections };
  });

  // 版本那行拿走之後,引言開頭會剩一行空的 `>`。
  const introLines = trimBlankEdges(intro);
  while (introLines.length > 0 && introLines[0].trim() === ">") introLines.shift();

  return {
    title,
    version,
    versionNotes,
    intro: introLines.join("\n"),
    legend: trimBlankEdges(legend).join("\n"),
    chapters,
  };
}

/** 這個人看得到的章節。 */
export function visibleChapters(manual: Manual, isAdmin: boolean): ManualChapter[] {
  return isAdmin ? manual.chapters : manual.chapters.filter((c) => !c.adminOnly);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Markdown → HTML。圖片改指到有權限檢查的圖片網址,外部連結開新分頁,三級標題加錨點。 */
export function renderManualHtml(markdown: string): string {
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        return depth === 3 ? `<h3 id="${sectionIdFromText(text)}">${text}</h3>\n` : `<h${depth}>${text}</h${depth}>\n`;
      },
      image({ href, text }) {
        const src = href.startsWith("manual-images/") ? MANUAL_IMAGE_URL + encodeURIComponent(href.slice("manual-images/".length)) : href;
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}" loading="lazy" decoding="async">`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//i.test(href);
        return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false });
  // 手冊裡有幾張圖是直接寫 <img src="manual-images/…">(表格裡並排的圖),一樣改指到圖片網址。
  return html.replace(/src="manual-images\/([^"]+)"/g, (_match, name: string) => `src="${MANUAL_IMAGE_URL}${name}" loading="lazy"`);
}

/** 章節裡引用的手冊圖片檔名(`manual-images/xx.jpg` 的 xx.jpg),Markdown 圖片與內嵌的 <img> 都算。 */
export function manualImageNames(markdown: string): string[] {
  const names = new Set<string>();
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(manual-images\/([^)\s]+)\)/g)) names.add(decodeURIComponent(m[1]));
  for (const m of markdown.matchAll(/src="manual-images\/([^"]+)"/g)) names.add(m[1]);
  return [...names];
}

/** 搜尋用的純文字:拿掉圖片、連結網址、表格與強調的符號。 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, " ")
    .replace(/^[#>\s]+/gm, "")
    .replace(/[*`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type SearchSnippet = { before: string; match: string; after: string };
export type SearchHit = { chapterId: string; number: number; title: string; count: number; snippets: SearchSnippet[] };

export const MIN_SEARCH_LENGTH = 2;
const SNIPPETS_PER_CHAPTER = 3;
const SNIPPET_CONTEXT = 28;

/** 在這些章節裡找 query(至少兩個字、不分大小寫),回傳有出現的章節、出現次數與前幾段上下文。 */
export function searchManual(chapters: ManualChapter[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_SEARCH_LENGTH) return [];
  const hits: SearchHit[] = [];
  for (const chapter of chapters) {
    const text = `${chapter.title}\n${toPlainText(chapter.markdown)}`;
    const lowered = text.toLowerCase();
    const snippets: SearchSnippet[] = [];
    let count = 0;
    for (let at = lowered.indexOf(q); at >= 0; at = lowered.indexOf(q, at + q.length)) {
      count++;
      if (snippets.length < SNIPPETS_PER_CHAPTER) {
        snippets.push({
          before: (at > SNIPPET_CONTEXT ? "…" : "") + text.slice(Math.max(0, at - SNIPPET_CONTEXT), at),
          match: text.slice(at, at + q.length),
          after: text.slice(at + q.length, at + q.length + SNIPPET_CONTEXT) + (at + q.length + SNIPPET_CONTEXT < text.length ? "…" : ""),
        });
      }
    }
    if (count > 0) hits.push({ chapterId: chapter.id, number: chapter.number, title: chapter.title, count, snippets });
  }
  return hits;
}
