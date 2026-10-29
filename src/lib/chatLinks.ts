/**
 * 對話裡附的「連結」:外面的網址,或本系統裡的工作項 / 風險 / 議題。
 *
 * 只收兩種:http(s) 的網址,以及本系統看板底下的路徑(/boards/…,給「引用工作項、風險、議題」用)。
 * 其他一律擋掉——尤其是 javascript:、data: 這類會在點下去時執行東西的。
 */

export const MAX_LINKS_PER_MESSAGE = 10;
const MAX_LABEL_LENGTH = 80;
const MAX_URL_LENGTH = 2000;

export type ChatLinkInput = { url: string; label?: string };
export type ChatLink = { url: string; label: string };

/** 本系統裡的位置:/boards/看板id,後面可以有 ?highlight=… 或 ?view=risks。 */
const INTERNAL_PATH = /^\/boards\/[A-Za-z0-9_-]+(\?[A-Za-z0-9_=&.%-]*)?$/;

export function normalizeChatLink(input: ChatLinkInput): { link: ChatLink } | { error: string } {
  const raw = input.url.trim();
  if (!raw) return { error: "請輸入連結的網址" };
  if (raw.length > MAX_URL_LENGTH) return { error: "網址太長" };

  let url: string;
  if (raw.startsWith("/")) {
    if (!INTERNAL_PATH.test(raw)) return { error: "這不是本系統看板的位置" };
    url = raw;
  } else {
    // 沒寫通訊協定的(例如 example.com/doc)補 https://;寫了別的協定(javascript:、data:、ftp:…)就擋掉。
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    let parsed: URL;
    try {
      parsed = new URL(withScheme);
    } catch {
      return { error: "網址的格式不正確" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: "只能附 http 或 https 開頭的網址" };
    if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") return { error: "網址的格式不正確" };
    url = parsed.toString();
  }

  const label = (input.label ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
  return { link: { url, label: label || displayNameOf(url) } };
}

/** 沒取名字時顯示什麼:外面的網址顯示網域與路徑,本系統的位置顯示「本系統連結」。 */
function displayNameOf(url: string): string {
  if (url.startsWith("/")) return "本系統連結";
  const parsed = new URL(url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  const shown = `${parsed.hostname}${path}`;
  return shown.length > MAX_LABEL_LENGTH ? `${shown.slice(0, MAX_LABEL_LENGTH - 1)}…` : shown;
}

/** 一則訊息的連結一次檢查完:數量、每一個。回傳整理好的清單或第一個錯誤。 */
export function normalizeChatLinks(inputs: ChatLinkInput[]): { links: ChatLink[] } | { error: string } {
  if (inputs.length > MAX_LINKS_PER_MESSAGE) return { error: `一則訊息最多 ${MAX_LINKS_PER_MESSAGE} 個連結` };
  const links: ChatLink[] = [];
  for (const input of inputs) {
    const result = normalizeChatLink(input);
    if ("error" in result) return { error: result.error };
    links.push(result.link);
  }
  return { links };
}

/**
 * 對話裡能引用 / 轉成待辦或留言的四類項目:工作項,以及風險登記冊的風險、議題,
 * 和從 MantisBT 同步來的問題(帶 Mantis 編號;看板上同步來的那個分頁叫「問題」)。
 */
export type RefKind = "item" | "risk" | "issue" | "mantis";

/** 引用本系統的一個項目:工作項指到那一列,風險、議題指到風險登記冊(風險 / 議題分頁)。 */
export function internalRefUrl(ref: { kind: RefKind; boardId: string; id: string }): string {
  // 風險、議題帶上自己的 id(risk=…,頁面目前不用它):不然同一則訊息引用兩筆風險會是同一個網址,被當成重複的連結。
  return ref.kind === "item" ? `/boards/${ref.boardId}?highlight=${ref.id}` : `/boards/${ref.boardId}?view=risks&risk=${ref.id}`;
}
