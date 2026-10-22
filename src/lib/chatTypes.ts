import type { ChatKind } from "@prisma/client";

/** 對話清單上的一列。看板頻道在第一次有人開之前沒有對話紀錄,id 是 null,用 key 區分。 */
export type ChatConversationDto = {
  /** 對話 id;還沒建立的看板頻道用 `board:看板id`。 */
  key: string;
  id: string | null;
  kind: ChatKind;
  boardId: string | null;
  title: string;
  /** 私訊:對方。 */
  otherUserId: string | null;
  otherAvatarUrl: string | null;
  /** 群組:成員(含自己)。 */
  memberIds: string[];
  unread: number;
  /** ISO 字串;從來沒有訊息就是 null。 */
  lastMessageAt: string | null;
  lastPreview: string | null;
};

export type ChatMessageDto = {
  id: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  /** 收回的訊息內容是空字串。 */
  body: string;
  deleted: boolean;
  /** ISO 字串 */
  createdAt: string;
};

/** 私訊與群組的已讀位置(誰讀到什麼時候);看板頻道人多,不追蹤顯示。 */
export type ChatReadState = { userId: string; lastReadAt: string };

export type ChatMessagePage = {
  messages: ChatMessageDto[];
  /** 比這一頁更早的還有嗎。 */
  hasMore: boolean;
  readStates: ChatReadState[];
};

export type ChatFailure = { error: string };
export type ChatResult<T> = ({ error?: undefined } & T) | ChatFailure;

/** `if (isChatError(r))` 之後,另一邊就是成功的那一種(單看 `if (r.error)` 擋不掉空字串,TypeScript 不會收斂)。 */
export function isChatError<T>(result: ChatResult<T>): result is ChatFailure {
  return result.error !== undefined;
}
