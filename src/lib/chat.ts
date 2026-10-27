import type { ChatKind } from "@prisma/client";

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_GROUP_TITLE_LENGTH = 40;
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** 同一個人連續發的訊息,間隔在這個時間內就併成一組(只有第一則顯示名字與頭像)。 */
export const RUN_GAP_MS = 5 * 60 * 1000;

/** 兩個人的私訊用同一個鍵:id 排序後接起來,誰先開的都是同一間。 */
export function dmKeyOf(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** 只傳檔案、沒有文字的訊息也行(hasFiles)。 */
export function normalizeMessageBody(raw: string, hasFiles = false): { body: string } | { error: string } {
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (!body && !hasFiles) return { error: "訊息不可為空" };
  if (body.length > MAX_MESSAGE_LENGTH) return { error: `訊息太長(最多 ${MAX_MESSAGE_LENGTH} 字)` };
  return { body };
}

export function normalizeGroupTitle(raw: string): { title: string } | { error: string } {
  const title = raw.trim();
  if (!title) return { error: "請輸入聊天室名稱" };
  if (title.length > MAX_GROUP_TITLE_LENGTH) return { error: `名稱太長(最多 ${MAX_GROUP_TITLE_LENGTH} 字)` };
  return { title };
}

/** 對話清單與通知裡的一行摘要:換行壓成空白、太長截短。 */
export function snippet(body: string, max = 60): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 檔案的數量與大小是否在限制內;回傳錯誤訊息,沒問題回 null。 */
export function validateAttachments(files: { name: string; size: number }[]): string | null {
  if (files.length > MAX_ATTACHMENTS) return `一則訊息最多 ${MAX_ATTACHMENTS} 個檔案`;
  const empty = files.find((f) => f.size === 0);
  if (empty) return `「${empty.name}」是空的檔案`;
  const big = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);
  if (big) return `「${big.name}」超過 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB,請改用雲端硬碟連結`;
  return null;
}

/** 存到磁碟用的檔名:去掉路徑分隔與控制字元(不信任使用者給的檔名)。 */
export function safeAttachmentName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "_").trim().replace(/^\.+/, "_");
  return cleaned.slice(0, 120) || "file";
}

/** 可以直接顯示在訊息裡的圖片。SVG 不算:它能夾帶 script,一律當檔案下載。 */
export function isInlineImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(name);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 清單與通知裡這則訊息的一行摘要:有文字用文字,只有檔案就寫傳了檔案。 */
export function messagePreview(body: string, hasFiles: boolean, max = 60): string {
  return body.trim() ? snippet(body, max) : hasFiles ? "傳了附件" : "";
}

/** 搜尋結果裡的一小段:命中的字前後各取一些,太長的用 … 收尾。 */
export function matchSnippet(body: string, query: string, before = 30, after = 60): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const q = query.trim().toLowerCase();
  const at = q ? flat.toLowerCase().indexOf(q) : -1;
  if (at < 0) return snippet(flat, before + after);
  const from = Math.max(0, at - before);
  const to = Math.min(flat.length, at + q.length + after);
  return `${from > 0 ? "…" : ""}${flat.slice(from, to)}${to < flat.length ? "…" : ""}`;
}

/** 這則訊息要不要重新顯示名字與頭像:換人、隔太久、或換了一天。 */
export function startsNewRun(
  prev: { authorId: string; createdAt: string } | null,
  cur: { authorId: string; createdAt: string }
): boolean {
  if (!prev) return true;
  if (prev.authorId !== cur.authorId) return true;
  if (dayKey(prev.createdAt) !== dayKey(cur.createdAt)) return true;
  return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() > RUN_GAP_MS;
}

/** 台北時間的日期(YYYY-MM-DD),訊息依它分日。 */
export function dayKey(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 日期分隔線上的字:今天、昨天,其他寫月/日(跨年才寫年)。 */
export function dayLabel(iso: string, now: Date): string {
  const key = dayKey(iso);
  const today = dayKey(now.toISOString());
  if (key === today) return "今天";
  if (key === dayKey(new Date(now.getTime() - 24 * 3600 * 1000).toISOString())) return "昨天";
  const [y, m, d] = key.split("-").map(Number);
  return y === Number(today.slice(0, 4)) ? `${m}/${d}` : `${y}/${m}/${d}`;
}

/** 訊息旁的時間:台北時間 24 小時制 HH:mm。 */
export function clockLabel(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);
}

/** 對話清單上的名稱:私訊是對方的名字,看板頻道是看板名稱,群組是它自己的名稱。 */
export function conversationTitle(c: { kind: ChatKind; title: string | null; boardName: string | null; otherName: string | null }): string {
  if (c.kind === "DM") return c.otherName ?? "(已刪除的使用者)";
  if (c.kind === "BOARD") return c.boardName ?? "(看板)";
  return c.title ?? "聊天室";
}

export type ChatEventType = "message" | "read" | "deleted" | "conversation" | "comment";

/** 推給瀏覽器的事件內容:只有「哪裡有變」,不帶訊息本文——內容一律由瀏覽器再用有權限檢查的 action 去讀。 */
export type ChatEventPayload = {
  type: ChatEventType;
  /** conversationId;comment 事件(工作項有新留言)是工作項 id。 */
  c: string;
  /** 發訊息 / 讀的人;conversation 事件則是要通知的人。 */
  u: string | null;
  /** messageId */
  m: string | null;
};

/** 一個 Server-Sent Event 區塊。斷線重連後漏掉的由瀏覽器自己重讀,伺服器不補發。 */
export function formatSseEvent(payload: ChatEventPayload): string {
  return `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export type ChatNotification = { userId: string; message: string };

/**
 * 一則新訊息要通知誰、寫什麼:
 * - 被 @ 到的人(不含自己)一定通知;
 * - 私訊與群組:其他成員也通知,但同一段未讀只通知第一次(alreadyUnread),不然聊一百句就是一百則;
 * - 看板頻道:除了被 @ 到的人,不通知任何人(頻道人多、話多)。
 * 呼叫端先把 mentionedIds 篩成「看得到這間對話的人」。
 */
export function planChatNotifications(input: {
  kind: ChatKind;
  conversationName: string;
  actorId: string;
  actorName: string;
  /** 私訊與群組的全部成員(看板頻道用不到)。 */
  memberIds: string[];
  mentionedIds: string[];
  /** 已經有一則這間對話的未讀通知的人。 */
  alreadyUnread: Set<string>;
}): ChatNotification[] {
  const out = new Map<string, string>();
  if (input.kind !== "BOARD") {
    const text = directNotificationText(input.actorName, input.conversationName, input.kind);
    for (const id of input.memberIds) {
      if (id !== input.actorId && !input.alreadyUnread.has(id)) out.set(id, text);
    }
  }
  const mention = mentionNotificationText(input.actorName, input.conversationName, input.kind);
  for (const id of input.mentionedIds) {
    if (id !== input.actorId) out.set(id, mention);
  }
  return [...out].map(([userId, message]) => ({ userId, message }));
}

/** 被 @ 提到的通知。 */
export function mentionNotificationText(actorName: string, conversationName: string, kind: ChatKind): string {
  return kind === "DM" ? `${actorName} 在私訊中提到你` : `${actorName} 在「${conversationName}」提到你`;
}

/** 私訊與群組的新訊息通知(同一段未讀只通知第一次,看板頻道只通知被 @ 到的人)。 */
export function directNotificationText(actorName: string, conversationName: string, kind: ChatKind): string {
  return kind === "DM" ? `${actorName} 傳了訊息給你` : `${actorName} 在「${conversationName}」有新訊息`;
}
