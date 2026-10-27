"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, FileText, Link2, ListTodo, MessageSquareQuote, Paperclip, Send, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { MentionText } from "@/components/board/item-detail/MentionText";
import { useDialogs } from "@/components/ui/DialogProvider";
import { deleteChatMessage, loadChatMessages, markChatRead, sendChatMessage } from "@/lib/actions/chat";
import { clockLabel, dayKey, dayLabel, formatFileSize, startsNewRun, validateAttachments } from "@/lib/chat";
import { activeMentionQuery } from "@/lib/mentions";
import { isChatError, type ChatConversationDto, type ChatMessageDto, type ChatReadState } from "@/lib/chatTypes";
import { useChat } from "./ChatProvider";
import { ConvertMessageDialog } from "./ChatConvertDialog";
import { BoardRefPicker, REF_KIND_LABELS } from "./BoardRefPicker";
import { MAX_LINKS_PER_MESSAGE, internalRefUrl, normalizeChatLink, type ChatLink } from "@/lib/chatLinks";

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
  jumpToMessageId = null,
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
  /** 從搜尋結果點進來:載到那一則、捲過去、標一下。 */
  jumpToMessageId?: string | null;
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
  const [files, setFiles] = useState<File[]>([]);
  /** 這則訊息要附的連結(外面的網址,或引用本系統的工作項、風險、問題)。 */
  const [links, setLinks] = useState<ChatLink[]>([]);
  /** 「連結 / 引用」面板:null = 收著。 */
  const [attachPanel, setAttachPanel] = useState<null | "url" | "ref">(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlLabelDraft, setUrlLabelDraft] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [convert, setConvert] = useState<{ message: ChatMessageDto; mode: "todo" | "comment" } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
      // 從搜尋結果點進來:一頁一頁往前載,直到載到那一則(最多 40 頁)。
      let loaded = page.messages;
      let more = page.hasMore;
      if (jumpToMessageId) {
        for (let pages = 0; pages < 40 && more && !loaded.some((m) => m.id === jumpToMessageId); pages++) {
          const older = await loadChatMessages(conversationId, { beforeId: loaded[0].id });
          if (cancelled || isChatError(older)) break;
          loaded = mergeMessages(loaded, older.messages);
          more = older.hasMore;
        }
        if (cancelled) return;
      }
      setMessages(loaded);
      setHasMore(more);
      setReadStates(page.readStates);
      setLoading(false);
      if (jumpToMessageId && loaded.some((m) => m.id === jumpToMessageId)) {
        stick.current = false;
        forceBottom.current = false;
        setFlashId(jumpToMessageId);
      }
      void markRead();
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, markRead, notify, jumpToMessageId]);

  // 跳到搜尋的那一則:捲到畫面中間,幾秒後取消標示。
  useEffect(() => {
    if (!flashId) return;
    document.querySelector(`[data-chat-message="${flashId}"]`)?.scrollIntoView({ block: "center" });
    const timer = setTimeout(() => setFlashId(null), 3000);
    return () => clearTimeout(timer);
  }, [flashId]);

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

  function addFiles(list: File[]) {
    if (list.length === 0) return;
    const next = [...files, ...list];
    const error = validateAttachments(next.map((f) => ({ name: f.name, size: f.size })));
    if (error) {
      void notify(error, { title: "無法加入檔案" });
      return;
    }
    setFiles(next);
  }

  function addLink(link: ChatLink) {
    if (links.length >= MAX_LINKS_PER_MESSAGE) {
      void notify(`一則訊息最多 ${MAX_LINKS_PER_MESSAGE} 個連結`, { title: "無法加入連結" });
      return;
    }
    if (links.some((l) => l.url === link.url)) return;
    setLinks((prev) => [...prev, link]);
  }

  function submitUrl() {
    const result = normalizeChatLink({ url: urlDraft, label: urlLabelDraft });
    if ("error" in result) {
      setUrlError(result.error);
      return;
    }
    addLink(result.link);
    setUrlDraft("");
    setUrlLabelDraft("");
    setUrlError(null);
    setAttachPanel(null);
  }

  async function send() {
    const text = draft.trim();
    if ((!text && files.length === 0 && links.length === 0) || sending) return;
    setSending(true);
    const form = new FormData();
    form.append("body", text);
    for (const file of files) form.append("file", file);
    if (links.length > 0) form.append("links", JSON.stringify(links));
    const result = await sendChatMessage(conversationId, form);
    setSending(false);
    if (isChatError(result)) {
      await notify(result.error, { title: "訊息沒有送出" });
      return;
    }
    setDraft("");
    setFiles([]);
    setLinks([]);
    setAttachPanel(null);
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
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-blue-500/10 text-sm font-medium text-blue-700 ring-2 ring-inset ring-blue-400 dark:text-blue-300">
          放開以加入檔案
        </div>
      )}
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
                  className={`group flex gap-2 px-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 ${header ? "pt-2" : ""} ${
                    flashId === m.id ? "bg-amber-50 ring-2 ring-inset ring-amber-300 dark:bg-amber-950/30" : ""
                  }`}
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
                      <>
                        {m.body && (
                          <div className="break-words">
                            <MentionText body={m.body} users={users} />
                          </div>
                        )}
                        {m.attachments.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {m.attachments.map((a) =>
                              a.link ? (
                                <a
                                  key={a.id}
                                  href={a.link}
                                  target="_blank"
                                  rel="noreferrer"
                                  data-chat-link
                                  title={a.link}
                                  className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
                                >
                                  <Link2 size={14} className="shrink-0" />
                                  <span className="max-w-64 truncate">{a.fileName}</span>
                                </a>
                              ) : a.isImage ? (
                                <a key={a.id} href={`/api/chat/attachments/${a.id}`} target="_blank" rel="noreferrer" title={a.fileName}>
                                  {/* eslint-disable-next-line @next/next/no-img-element -- 對話附件走有權限檢查的 API,用不到 next/image */}
                                  <img
                                    src={`/api/chat/attachments/${a.id}`}
                                    alt={a.fileName}
                                    data-chat-image
                                    className="max-h-60 max-w-xs rounded-md border border-neutral-200 object-contain dark:border-neutral-700"
                                  />
                                </a>
                              ) : (
                                <a
                                  key={a.id}
                                  href={`/api/chat/attachments/${a.id}`}
                                  data-chat-file
                                  className="flex items-center gap-2 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                >
                                  <FileText size={14} className="shrink-0 text-neutral-400" />
                                  <span className="max-w-56 truncate">{a.fileName}</span>
                                  <span className="shrink-0 text-neutral-400">{formatFileSize(a.size)}</span>
                                </a>
                              )
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {m.id === lastMineId && receipt && (
                      <p data-chat-receipt className="text-right text-[10px] text-neutral-400">
                        {receipt}
                      </p>
                    )}
                  </div>
                  {!m.deleted && (
                    <div className="flex items-start self-start opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                      {m.body && (
                        <>
                          <button
                            type="button"
                            onClick={() => setConvert({ message: m, mode: "todo" })}
                            title="轉成工作項的待辦事項"
                            aria-label="轉成待辦事項"
                            className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-blue-600 dark:hover:bg-neutral-700"
                          >
                            <ListTodo size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConvert({ message: m, mode: "comment" })}
                            title="轉成工作項的留言"
                            aria-label="轉成工作項留言"
                            className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-blue-600 dark:hover:bg-neutral-700"
                          >
                            <MessageSquareQuote size={13} />
                          </button>
                        </>
                      )}
                      {mine && (
                        <button
                          type="button"
                          onClick={() => void recall(m)}
                          title="收回"
                          aria-label="收回這則訊息"
                          className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-red-600 dark:hover:bg-neutral-700"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
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
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5" data-chat-pending-files>
            {files.map((file, i) => (
              <span
                key={`${file.name}-${i}`}
                className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              >
                <FileText size={12} className="shrink-0 text-neutral-400" />
                <span className="max-w-48 truncate">{file.name}</span>
                <span className="text-neutral-400">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`移除 ${file.name}`}
                  className="text-neutral-400 hover:text-red-600"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {links.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5" data-chat-pending-links>
            {links.map((link, i) => (
              <span
                key={`${link.url}-${i}`}
                title={link.url}
                className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
              >
                <Link2 size={12} className="shrink-0" />
                <span className="max-w-56 truncate">{link.label}</span>
                <button
                  type="button"
                  onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`移除連結 ${link.label}`}
                  className="text-blue-400 hover:text-red-600"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {attachPanel && (
          <div className="mb-2 space-y-2 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-700" data-chat-attach-panel>
            <div className="flex items-center justify-between">
              <div className="flex gap-1" role="tablist">
                {(
                  [
                    ["url", "貼上網址"],
                    ["ref", "引用工作項 / 風險 / 問題 / 議題"],
                  ] as const
                ).map(([key, name]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={attachPanel === key}
                    data-attach-tab={key}
                    onClick={() => setAttachPanel(key)}
                    className={`rounded-md px-2.5 py-1 text-xs ${
                      attachPanel === key
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                        : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setAttachPanel(null)} aria-label="收起" className="text-neutral-400 hover:text-neutral-700">
                <X size={14} />
              </button>
            </div>
            {attachPanel === "url" ? (
              <div className="space-y-2">
                <input
                  value={urlDraft}
                  onChange={(e) => {
                    setUrlDraft(e.target.value);
                    setUrlError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitUrl();
                    }
                  }}
                  placeholder="貼上網址,例如 https://drive.google.com/…"
                  data-attach-url
                  className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                />
                <input
                  value={urlLabelDraft}
                  onChange={(e) => setUrlLabelDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitUrl();
                    }
                  }}
                  placeholder="顯示的名稱(選填,沒填就顯示網址)"
                  data-attach-label
                  className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
                />
                {urlError && <p className="text-xs text-red-600">{urlError}</p>}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={submitUrl}
                    data-attach-url-add
                    className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                  >
                    加入連結
                  </button>
                </div>
              </div>
            ) : (
              <BoardRefPicker
                boardId={conversation.boardId}
                kinds={["item", "risk", "issue", "mantis"]}
                onPick={(ref) => {
                  addLink({ url: internalRefUrl(ref), label: `${REF_KIND_LABELS[ref.kind]}:${ref.name}` });
                  setAttachPanel(null);
                }}
              />
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            data-chat-file-input
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title="傳檔案或圖片(也可以直接拖進來、或貼上截圖)"
            aria-label="加檔案"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <Paperclip size={16} />
          </button>
          <button
            type="button"
            onClick={() => setAttachPanel((prev) => (prev ? null : "url"))}
            title="附連結:貼上網址,或引用這個看板的工作項、風險、問題、議題"
            aria-label="加連結"
            data-chat-link-button
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
              attachPanel ? "text-blue-600" : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            <Link2 size={16} />
          </button>
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
            onPaste={(e) => {
              // 貼上截圖或檔案:加成附件;貼文字照舊進輸入框。
              if (e.clipboardData.files.length > 0) {
                e.preventDefault();
                addFiles(Array.from(e.clipboardData.files));
              }
            }}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
            onClick={(e) => setCaret(e.currentTarget.selectionStart)}
            className="min-w-0 flex-1 resize-none rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={(!draft.trim() && files.length === 0 && links.length === 0) || sending}
            data-chat-send
            aria-label="送出"
            className="flex h-9 shrink-0 items-center gap-1 rounded-md bg-blue-600 px-3 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Send size={14} />
            送出
          </button>
        </div>
      </div>
      {convert && <ConvertMessageDialog message={convert.message} mode={convert.mode} boardId={conversation.boardId} onClose={() => setConvert(null)} />}
    </div>
  );
}
