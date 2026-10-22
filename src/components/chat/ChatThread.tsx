"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Send, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { MentionText } from "@/components/board/item-detail/MentionText";
import { useDialogs } from "@/components/ui/DialogProvider";
import { deleteChatMessage, loadChatMessages, markChatRead, sendChatMessage } from "@/lib/actions/chat";
import { clockLabel, dayKey, dayLabel, startsNewRun } from "@/lib/chat";
import { activeMentionQuery } from "@/lib/mentions";
import { isChatError, type ChatConversationDto, type ChatMessageDto, type ChatReadState } from "@/lib/chatTypes";
import { useChat } from "./ChatProvider";

type ChatUser = { id: string; name: string; avatarUrl: string | null };

/** 離底部這麼近(px)就算「在最底下」,新訊息來了自動捲到底。 */
const STICK_PX = 80;

function mergeMessages(current: ChatMessageDto[], incoming: ChatMessageDto[]): ChatMessageDto[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * 一間對話:訊息串(舊的在上、新的在下)與輸入框。新訊息由即時推送通知、再用有權限檢查的 action 重讀;
 * 這個畫面開著且分頁在前景時,收到的訊息馬上標已讀。
 */
export function ChatThread({
  conversation,
  users,
  currentUserId,
  onMarkedRead,
  onBack,
  actions,
}: {
  conversation: ChatConversationDto & { id: string };
  users: ChatUser[];
  currentUserId: string;
  /** 標完已讀之後:對話清單的未讀數要跟著更新。 */
  onMarkedRead: () => void;
  /** 手機版:回對話清單。 */
  onBack: () => void;
  /** 標題列右邊的按鈕(群組的加成員、改名、離開)。 */
  actions?: React.ReactNode;
}) {
  const { subscribe } = useChat();
  const { notify, confirm } = useDialogs();
  const conversationId = conversation.id;
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [readStates, setReadStates] = useState<ChatReadState[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [now] = useState(() => new Date());

  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const forceBottom = useRef(false);
  /** 畫面上最新一則的時間——重讀回來比它新、又不在底部,就亮「有新訊息」。 */
  const newestShown = useRef<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // 能 @ 誰:群組只有成員、看板頻道是所有人(沒權限的人伺服器不會通知)、私訊不需要。
  const mentionable = useMemo(() => {
    if (conversation.kind === "DM") return [];
    if (conversation.kind === "GROUP") return users.filter((u) => conversation.memberIds.includes(u.id));
    return users;
  }, [conversation.kind, conversation.memberIds, users]);
  const query = activeMentionQuery(draft, caret);
  const matches =
    query && query.at !== dismissedAt
      ? mentionable.filter((u) => u.id !== currentUserId && u.name.toLowerCase().includes(query.query.toLowerCase())).slice(0, 6)
      : [];
  const active = matches[Math.min(highlight, matches.length - 1)];

  const markRead = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const result = await markChatRead(conversationId);
    if (!result.error) onMarkedRead();
  }, [conversationId, onMarkedRead]);

  /** 重讀最新一頁併進目前的訊息(收回、新訊息、已讀位置都會跟上)。 */
  const refresh = useCallback(async () => {
    const page = await loadChatMessages(conversationId);
    if (isChatError(page)) return;
    const newest = page.messages[page.messages.length - 1];
    if (newest && newestShown.current && newest.createdAt > newestShown.current && newest.authorId !== currentUserId && !stick.current) {
      setUnseen(true);
    }
    setMessages((prev) => mergeMessages(prev, page.messages));
    setReadStates(page.readStates);
    void markRead();
  }, [conversationId, markRead, currentUserId]);

  // 換對話:重來一遍。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setMessages([]);
      setUnseen(false);
      stick.current = true;
      forceBottom.current = true;
      const page = await loadChatMessages(conversationId);
      if (cancelled) return;
      if (isChatError(page)) {
        await notify(page.error);
        setLoading(false);
        return;
      }
      setMessages(page.messages);
      setHasMore(page.hasMore);
      setReadStates(page.readStates);
      setLoading(false);
      void markRead();
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, markRead, notify]);

  // 即時推送:這間對話有動靜、或推送重連了,就重讀。
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === "open" || event.c === conversationId) void refresh();
      }),
    [subscribe, conversationId, refresh]
  );

  // 分頁從背景回到前景:這段時間來的訊息現在才算讀到。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  // 訊息變了:在底部(或剛送出訊息)就捲到最新。
  useLayoutEffect(() => {
    newestShown.current = messages[messages.length - 1]?.createdAt ?? null;
    const el = scroller.current;
    if (el && (forceBottom.current || stick.current)) {
      el.scrollTop = el.scrollHeight;
      forceBottom.current = false;
    }
  }, [messages]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (stick.current) setUnseen(false);
  }

  async function loadOlder() {
    const first = messages[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const beforeHeight = el?.scrollHeight ?? 0;
    const page = await loadChatMessages(conversationId, { beforeId: first.id });
    setLoadingOlder(false);
    if (isChatError(page)) return;
    stick.current = false;
    setMessages((prev) => mergeMessages(prev, page.messages));
    setHasMore(page.hasMore);
    // 往上補了訊息,捲動位置要留在原本看的那則,不能跳走。
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - beforeHeight;
    });
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const result = await sendChatMessage(conversationId, text);
    setSending(false);
    if (isChatError(result)) {
      await notify(result.error, { title: "訊息沒有送出" });
      return;
    }
    setDraft("");
    setCaret(0);
    forceBottom.current = true;
    setMessages((prev) => mergeMessages(prev, [result.message]));
    textarea.current?.focus();
  }

  async function recall(message: ChatMessageDto) {
    if (!(await confirm("收回這則訊息?收回後大家都不會再看到內容。", { confirmLabel: "收回", danger: true }))) return;
    const result = await deleteChatMessage(message.id);
    if (result.error) await notify(result.error);
    else void refresh();
  }

  function insertMention(name: string) {
    if (!query) return;
    const next = `${draft.slice(0, query.at)}@${name} ${draft.slice(caret)}`;
    const position = query.at + name.length + 2;
    setDraft(next);
    setCaret(position);
    setHighlight(0);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 中文輸入法選字時按 Enter 是確認選字,不是送出。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + matches.length) % matches.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && active) {
        e.preventDefault();
        insertMention(active.name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(query?.at ?? null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // 已讀:私訊顯示在自己最後一則「已讀」;群組顯示幾個人讀了。看板頻道人多,不顯示。
  const lastMineId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].authorId === currentUserId && !messages[i].deleted) return messages[i].id;
    }
    return null;
  }, [messages, currentUserId]);
  const lastMine = messages.find((m) => m.id === lastMineId);
  const readers = lastMine
    ? readStates.filter((r) => r.userId !== currentUserId && r.lastReadAt >= lastMine.createdAt).length
    : 0;
  const receipt = conversation.kind === "DM" ? (readers > 0 ? "已讀" : "") : conversation.kind === "GROUP" && readers > 0 ? `已讀 ${readers}` : "";

  const subtitle =
    conversation.kind === "BOARD"
      ? "看板頻道:看得到這個看板的人都在這裡"
      : conversation.kind === "GROUP"
        ? `${conversation.memberIds.length} 位成員:${conversation.memberIds
            .map((id) => users.find((u) => u.id === id)?.name)
            .filter(Boolean)
            .join("、")}`
        : "私訊";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-700">
        <button
          type="button"
          onClick={onBack}
          className="rounded px-1.5 py-0.5 text-sm text-neutral-500 hover:bg-neutral-100 md:hidden dark:hover:bg-neutral-800"
          aria-label="回對話清單"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{conversation.title}</h2>
          <p className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">{subtitle}</p>
        </div>
        {actions}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} data-chat-scroller className="h-full overflow-y-auto py-2">
          {loading && <p className="px-4 py-6 text-center text-sm text-neutral-400">載入中…</p>}
          {!loading && hasMore && (
            <div className="px-4 pb-2 text-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {loadingOlder ? "載入中…" : "載入更早的訊息"}
              </button>
            </div>
          )}
          {!loading && messages.length === 0 && <p className="px-4 py-10 text-center text-sm text-neutral-400">還沒有訊息,傳第一則吧。</p>}
          {messages.map((m, i) => {
            const prev = i > 0 ? messages[i - 1] : null;
            const header = startsNewRun(prev, m);
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const mine = m.authorId === currentUserId;
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-2 flex items-center gap-3 px-4 text-[11px] text-neutral-400">
                    <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
                    {dayLabel(m.createdAt, now)}
                    <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
                  </div>
                )}
                <div
                  data-chat-message={m.id}
                  className={`group flex gap-2 px-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 ${header ? "pt-2" : ""}`}
                >
                  <div className="w-8 shrink-0 pt-0.5">
                    {header && <Avatar name={m.authorName} avatarUrl={m.authorAvatarUrl} size={28} />}
                  </div>
                  <div className="min-w-0 flex-1" title={header ? undefined : clockLabel(m.createdAt)}>
                    {header && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{m.authorName}</span>
                        <span className="text-[11px] text-neutral-400">{clockLabel(m.createdAt)}</span>
                      </div>
                    )}
                    {m.deleted ? (
                      <p className="text-sm italic text-neutral-400">訊息已收回</p>
                    ) : (
                      <div className="break-words">
                        <MentionText body={m.body} users={users} />
                      </div>
                    )}
                    {m.id === lastMineId && receipt && (
                      <p data-chat-receipt className="text-right text-[10px] text-neutral-400">
                        {receipt}
                      </p>
                    )}
                  </div>
                  {mine && !m.deleted && (
                    <button
                      type="button"
                      onClick={() => void recall(m)}
                      title="收回"
                      aria-label="收回這則訊息"
                      className="self-start rounded p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-neutral-700"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {unseen && (
          <button
            type="button"
            onClick={() => {
              const el = scroller.current;
              if (el) el.scrollTop = el.scrollHeight;
              setUnseen(false);
            }}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-xs text-white shadow"
          >
            <ArrowDown size={12} />
            有新訊息
          </button>
        )}
      </div>

      <div className="relative border-t border-neutral-200 p-3 dark:border-neutral-700">
        {matches.length > 0 && (
          <ul className="absolute bottom-full left-3 z-10 mb-1 max-h-48 w-64 overflow-auto rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-md dark:border-neutral-700 dark:bg-neutral-900">
            {matches.map((u, i) => (
              <li key={u.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(u.name);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                    i === Math.min(highlight, matches.length - 1) ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  }`}
                >
                  <Avatar name={u.name} avatarUrl={u.avatarUrl} size={20} />
                  {u.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textarea}
            value={draft}
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            data-chat-input
            placeholder={`傳訊息給「${conversation.title}」(Enter 送出,Shift+Enter 換行${mentionable.length > 0 ? ",@ 提到人" : ""})`}
            onChange={(e) => {
              setDraft(e.target.value);
              setCaret(e.target.selectionStart);
              setHighlight(0);
              setDismissedAt(null);
            }}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
            onClick={(e) => setCaret(e.currentTarget.selectionStart)}
            className="min-w-0 flex-1 resize-none rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            data-chat-send
            aria-label="送出"
            className="flex h-9 shrink-0 items-center gap-1 rounded-md bg-blue-600 px-3 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Send size={14} />
            送出
          </button>
        </div>
      </div>
    </div>
  );
}
