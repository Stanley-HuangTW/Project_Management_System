import type { RefKind } from "@/lib/chatLinks";
import { riskKindOf } from "@/lib/chatRefs";

/**
 * 對話輸入框裡的「#」引用:打 # 加幾個字,跳出這個看板的工作項 / 風險 / 議題讓人挑(跟 @ 提到人同一個手感)。
 * 挑好的會在訊息裡變成可以點的 #名稱,並附上對應的連結。純邏輯。
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

export type RefSuggestion = {
  kind: RefKind;
  id: string;
  name: string;
  /** 清單上名稱旁的小字:工作項是 WBS 代號與分組,Mantis 來的議題是編號。 */
  hint: string;
};

type RefSource = {
  items: { id: string; name: string; wbsCode: string; groupName: string }[];
  risks: { id: string; title: string; kind: "RISK" | "ISSUE"; mantisId: number | null }[];
};

const SUGGESTION_LIMIT = 8;

/**
 * 符合關鍵字的工作項、風險、議題(名稱、WBS 代號、Mantis 編號,不分大小寫);
 * 名稱或代號是這幾個字開頭的排前面,其餘維持清單原本的順序。沒打字就列最前面幾筆。
 */
export function suggestRefs(refs: RefSource, query: string, limit = SUGGESTION_LIMIT): RefSuggestion[] {
  // 不 trim:挑好之後輸入框裡是「#名稱 」(後面一個空格),帶著空格就不再符合,清單才會收起來;名稱本身有空格的照樣找得到。
  const q = query.toLowerCase();
  if (q.length > 0 && q.trim() === "") return [];
  const scored: { suggestion: RefSuggestion; rank: number }[] = [];

  for (const item of refs.items) {
    const name = item.name.toLowerCase();
    if (q && !name.includes(q) && !item.wbsCode.toLowerCase().includes(q)) continue;
    const rank = !q || name.startsWith(q) || item.wbsCode.toLowerCase().startsWith(q) ? 0 : 1;
    scored.push({ suggestion: { kind: "item", id: item.id, name: item.name, hint: `${item.wbsCode} · ${item.groupName}` }, rank });
  }
  for (const risk of refs.risks) {
    const title = risk.title.toLowerCase();
    const mantis = risk.mantisId === null ? "" : String(risk.mantisId);
    if (q && !title.includes(q) && !(mantis && mantis.includes(q))) continue;
    const rank = !q || title.startsWith(q) ? 0 : 1;
    scored.push({
      suggestion: { kind: riskKindOf(risk), id: risk.id, name: risk.title, hint: mantis ? `Mantis #${mantis}` : "" },
      rank,
    });
  }
  // Array.prototype.sort 是穩定排序:同一等級維持原本的順序(工作項在前、風險、議題接在後)。
  return scored
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((s) => s.suggestion);
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
