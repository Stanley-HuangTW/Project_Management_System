import type { RefKind } from "@/lib/chatLinks";
import { filterItemsKeepingAncestors, parentIdsOf, riskKindOf, visibleTreeRows } from "@/lib/chatRefs";

/**
 * 對話輸入框裡的「#」引用:打 # 就跳出這個看板的工作項(巢狀、可以收放)、風險、議題、問題,
 * 打幾個字就縮小範圍(跟 @ 提到人同一個手感)。挑好的會在訊息裡變成可以點的 #名稱,並附上對應的連結。純邏輯。
 */

/**
 * 游標前面正在打的 # 引用的關鍵字,不是引用就回 null。
 * # 前面要是開頭或空白——網址的 #錨點、C# 這類不算;名稱裡可以有空格,所以遇到空格不停,
 * 換行或打得太長才放棄。
 */
export function activeRefQuery(body: string, caret: number): { query: string; at: number } | null {
  const upToCaret = body.slice(0, caret);
  const at = upToCaret.lastIndexOf("#");
  if (at < 0) return null;
  const query = upToCaret.slice(at + 1);
  if (query.includes("\n") || query.length > 30) return null;
  const before = at > 0 ? upToCaret[at - 1] : " ";
  if (before.trim() !== "") return null;
  return { query, at };
}

type MenuSource = {
  items: { id: string; name: string; wbsCode: string; groupName: string; parentId: string | null; depth: number }[];
  risks: { id: string; title: string; kind: "RISK" | "ISSUE"; mantisId: number | null }[];
};

/** 選單上的一列:類別標題,或一筆可以挑的項目。 */
export type RefMenuRow =
  | { type: "section"; kind: RefKind; count: number; collapsed: boolean }
  | {
      type: "ref";
      kind: RefKind;
      id: string;
      name: string;
      /** 名稱旁的小字:工作項是 WBS 代號(分組不只一個時加分組),Mantis 來的問題是編號。 */
      hint: string;
      depth: number;
      /** 有子項(工作項才有),前面放收放的箭頭。 */
      hasChildren: boolean;
      expanded: boolean;
      /** 只是為了顯示位置而帶出來的上層(搜尋時),自己不符合;游標鍵跳過它,滑鼠還是點得到。 */
      muted: boolean;
    }
  | { type: "more"; count: number };

/** 選單一次最多畫幾列;再多就請使用者多打幾個字縮小範圍,不畫幾千列。 */
export const REF_MENU_LIMIT = 150;

/** 類別在選單上的順序。 */
const KIND_ORDER: RefKind[] = ["item", "risk", "issue", "mantis"];

/** 預設展開的工作項:最上層而且有子項的,一打開就看得到第一、二層,更深的收著。 */
export function defaultExpandedItems(items: { id: string; depth: number; parentId: string | null }[]): Set<string> {
  const parents = parentIdsOf(items);
  return new Set(items.filter((i) => i.depth === 0 && parents.has(i.id)).map((i) => i.id));
}

/**
 * 「#」選單要畫哪些列。
 * - 沒打字:四個類別各一段(有東西的才有標題),工作項照階層巢狀、看 expanded 收放,類別標題也可以收起來(collapsedKinds)。
 * - 打了字:名稱、WBS 代號、Mantis 編號符合的留下;工作項連同它的所有上層(淡色),不受收放影響,類別都展開。
 *   不 trim:挑好之後輸入框裡是「#名稱 」(後面一個空格),帶著空格就不再符合,選單才會收起來;名稱本身有空格的照樣找得到。
 *   只有空格的關鍵字當作沒有符合。
 */
export function buildRefMenu(
  refs: MenuSource,
  query: string,
  state: { expanded: ReadonlySet<string>; collapsedKinds: ReadonlySet<RefKind> }
): RefMenuRow[] {
  const q = query.toLowerCase();
  if (q.length > 0 && q.trim() === "") return [];
  const searching = q.length > 0;
  const parents = parentIdsOf(refs.items);
  const multiGroup = new Set(refs.items.map((i) => i.groupName)).size > 1;

  const rows: RefMenuRow[] = [];
  for (const kind of KIND_ORDER) {
    const body: RefMenuRow[] = [];
    let count = 0;
    if (kind === "item") {
      const kept = searching
        ? filterItemsKeepingAncestors(refs.items, q, { trim: false })
        : visibleTreeRows(refs.items, state.expanded).map((item) => ({ item, muted: false }));
      count = searching ? kept.filter((k) => !k.muted).length : refs.items.length;
      for (const { item, muted } of kept) {
        body.push({
          type: "ref",
          kind,
          id: item.id,
          name: item.name,
          hint: multiGroup ? `${item.wbsCode} · ${item.groupName}` : item.wbsCode,
          depth: item.depth,
          hasChildren: parents.has(item.id),
          expanded: searching ? true : state.expanded.has(item.id),
          muted,
        });
      }
    } else {
      for (const risk of refs.risks) {
        if (riskKindOf(risk) !== kind) continue;
        const mantis = risk.mantisId === null ? "" : String(risk.mantisId);
        if (searching && !risk.title.toLowerCase().includes(q) && !(mantis && mantis.includes(q))) continue;
        body.push({
          type: "ref",
          kind,
          id: risk.id,
          name: risk.title,
          hint: mantis ? `Mantis #${mantis}` : "",
          depth: 0,
          hasChildren: false,
          expanded: false,
          muted: false,
        });
      }
      count = body.length;
    }
    if (body.length === 0) continue;
    const collapsed = !searching && state.collapsedKinds.has(kind);
    rows.push({ type: "section", kind, count, collapsed });
    if (!collapsed) rows.push(...body);
  }

  if (rows.length <= REF_MENU_LIMIT) return rows;
  const shown = rows.slice(0, REF_MENU_LIMIT);
  const hidden = rows.slice(REF_MENU_LIMIT).filter((r) => r.type === "ref").length;
  return hidden > 0 ? [...shown, { type: "more", count: hidden }] : shown;
}

/** 游標鍵走得到的列(跳過標題、淡色的上層、「還有 N 筆」)。 */
export function navigableRefs(rows: RefMenuRow[]): Extract<RefMenuRow, { type: "ref" }>[] {
  return rows.filter((r): r is Extract<RefMenuRow, { type: "ref" }> => r.type === "ref" && !r.muted);
}

export type RefBodySegment = { kind: "text"; text: string } | { kind: "ref"; text: string; url: string };

/** 這則訊息的附件裡,指到本系統某個項目的連結(label 是「工作項:名稱」那種,網址是 /boards/…)。 */
function refTargets(links: { url: string; label: string }[]): { name: string; url: string }[] {
  const targets: { name: string; url: string }[] = [];
  for (const link of links) {
    const colon = link.label.indexOf(":");
    const name = colon >= 0 ? link.label.slice(colon + 1) : "";
    if (name && link.url.startsWith("/boards/")) targets.push({ name, url: link.url });
  }
  // 名稱長的先比:「#電機選型 v2」不會被「#電機選型」搶走。
  return targets.sort((a, b) => b.name.length - a.name.length);
}

/**
 * 把訊息內文裡的 #名稱 找出來(名稱要是這則訊息附的連結之一,# 前面要是開頭或空白),
 * 讓畫面把它們畫成可以點的連結;其餘照舊是文字。
 */
export function splitRefs(body: string, links: { url: string; label: string }[]): RefBodySegment[] {
  const targets = refTargets(links);
  if (targets.length === 0) return body ? [{ kind: "text", text: body }] : [];
  const segments: RefBodySegment[] = [];
  let buffer = "";
  for (let i = 0; i < body.length; ) {
    const startsToken = body[i] === "#" && (i === 0 || body[i - 1].trim() === "");
    const target = startsToken ? targets.find((t) => body.startsWith(t.name, i + 1)) : undefined;
    if (!target) {
      buffer += body[i];
      i++;
      continue;
    }
    if (buffer) {
      segments.push({ kind: "text", text: buffer });
      buffer = "";
    }
    segments.push({ kind: "ref", text: `#${target.name}`, url: target.url });
    i += 1 + target.name.length;
  }
  if (buffer) segments.push({ kind: "text", text: buffer });
  return segments;
}

/** 內文裡已經畫成連結的那幾個網址——它們不必再在訊息下面重複放一張連結卡。 */
export function inlineRefUrls(body: string, links: { url: string; label: string }[]): Set<string> {
  return new Set(splitRefs(body, links).flatMap((s) => (s.kind === "ref" ? [s.url] : [])));
}
