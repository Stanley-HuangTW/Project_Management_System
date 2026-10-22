import type { ChatKind } from "@prisma/client";

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_GROUP_TITLE_LENGTH = 40;
/** 同一個人連續發的訊息,間隔在這個時間內就併成一組(只有第一則顯示名字與頭像)。 */
export const RUN_GAP_MS = 5 * 60 * 1000;

/** 兩個人的私訊用同一個鍵:id 排序後接起來,誰先開的都是同一間。 */
export function dmKeyOf(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function normalizeMessageBody(raw: string): { body: string } | { error: string } {
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (!body) return { error: "訊息不可為空" };
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

export type ChatEventType = "message" | "read" | "deleted" | "conversation";

/** 推給瀏覽器的事件內容:只有「哪裡有變」,不帶訊息本文——內容一律由瀏覽器再用有權限檢查的 action 去讀。 */
export type ChatEventPayload = {
  type: ChatEventType;
  /** conversationId */
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
