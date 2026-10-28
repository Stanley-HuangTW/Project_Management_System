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

export type ChatAttachmentDto = {
  id: string;
  fileName: string;
  size: number;
  /** 圖片:直接顯示在訊息裡。其他檔案是下載連結。 */
  isImage: boolean;
  /** 連結(不是檔案)才有:外面的網址或本系統看板的位置。 */
  link: string | null;
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
  /** 收回的訊息沒有檔案。 */
  attachments: ChatAttachmentDto[];
  /** ISO 字串 */
  createdAt: string;
};

/** 訊息搜尋的一筆結果。 */
export type ChatSearchHit = {
  messageId: string;
  /** 那間對話在清單上的 key(跟 ChatConversationDto.key 一樣)。 */
  conversationKey: string;
  conversationTitle: string;
  kind: "BOARD" | "DM" | "GROUP";
  authorName: string;
  /** ISO 字串 */
  createdAt: string;
  excerpt: string;
};

/** 挑項目用的清單:一個看板的工作項、風險、議題。 */
export type ChatBoardRefs = {
  boardId: string;
  boardName: string;
  /** 依分組、再依階層(父項在前、子項接在後)排好;depth 是第幾層(最上層 0)。 */
  items: { id: string; name: string; wbsCode: string; groupName: string; parentId: string | null; depth: number }[];
  risks: { id: string; title: string; kind: "RISK" | "ISSUE"; status: string; mantisId: number | null }[];
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
