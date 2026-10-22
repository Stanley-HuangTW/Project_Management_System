"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getChatUnread } from "@/lib/actions/chat";
import type { ChatEventPayload } from "@/lib/chat";

/** 推送連上了(open)或收到事件。 */
export type ChatStreamEvent = ChatEventPayload | { type: "open" };

type ChatContextValue = {
  /** 所有對話加起來的未讀訊息數(側邊欄的徽章)。 */
  unread: number;
  /** 即時推送連著嗎。沒連著時畫面改成定時重讀。 */
  connected: boolean;
  refreshUnread: () => void;
  subscribe: (handler: (event: ChatStreamEvent) => void) => () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

const EVENT_TYPES = ["message", "read", "deleted", "conversation", "comment"] as const;
const UNREAD_DEBOUNCE_MS = 300;
/** 推送萬一失靈(代理伺服器吃掉了串流……)的保底:定時重讀未讀數。 */
const FALLBACK_POLL_MS = 60_000;

/**
 * 整個登入後的畫面共用一條對話推送(EventSource):側邊欄的未讀徽章、對話頁的新訊息都吃它。
 * 代操作時不連(伺服器也會拒絕)。
 */
export function ChatProvider({ enabled, initialUnread, children }: { enabled: boolean; initialUnread: number; children: ReactNode }) {
  const [unread, setUnread] = useState(initialUnread);
  const [connected, setConnected] = useState(false);
  const handlers = useRef(new Set<(event: ChatStreamEvent) => void>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshUnread = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      getChatUnread().then(setUnread, () => {});
    }, UNREAD_DEBOUNCE_MS);
  }, []);

  const subscribe = useCallback((handler: (event: ChatStreamEvent) => void) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const emit = (event: ChatStreamEvent) => handlers.current.forEach((h) => h(event));
    const source = new EventSource("/api/chat/stream");
    source.onopen = () => {
      setConnected(true);
      // 連上(或斷線重連)之後,中間漏掉的由各處自己重讀。
      emit({ type: "open" });
      refreshUnread();
    };
    source.onerror = () => setConnected(false);
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (e) => {
        emit(JSON.parse((e as MessageEvent<string>).data) as ChatEventPayload);
        // 工作項留言的事件跟對話的未讀無關。
        if (type !== "comment") refreshUnread();
      });
    }
    const poll = setInterval(refreshUnread, FALLBACK_POLL_MS);
    return () => {
      source.close();
      clearInterval(poll);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [enabled, refreshUnread]);

  const value = useMemo(() => ({ unread, connected, refreshUnread, subscribe }), [unread, connected, refreshUnread, subscribe]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat 要放在 ChatProvider 底下");
  return value;
}
