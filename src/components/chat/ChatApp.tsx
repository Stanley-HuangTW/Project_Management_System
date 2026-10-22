"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hash, MessageSquarePlus, Pencil, UserPlus, Users, LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  addChatGroupMembers,
  createChatGroup,
  leaveChatGroup,
  listMyConversations,
  openBoardChat,
  openDirectChat,
  renameChatGroup,
  searchChatMessages,
} from "@/lib/actions/chat";
import { clockLabel, dayKey, dayLabel } from "@/lib/chat";
import { isChatError, type ChatConversationDto, type ChatSearchHit } from "@/lib/chatTypes";
import { AddMembersDialog, NewDirectChatDialog, NewGroupChatDialog } from "./ChatDialogs";
import { ChatThread } from "./ChatThread";
import { useChat } from "./ChatProvider";

type ChatUser = { id: string; name: string; avatarUrl: string | null };

const RELOAD_DEBOUNCE_MS = 200;
/** 推送沒連上時,對話清單改成這麼久重讀一次。 */
const FALLBACK_RELOAD_MS = 15_000;

function byRecent(a: ChatConversationDto, b: ChatConversationDto): number {
  if (a.lastMessageAt && b.lastMessageAt) return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
  if (a.lastMessageAt) return -1;
  if (b.lastMessageAt) return 1;
  return a.title.localeCompare(b.title, "zh-TW");
}

function pushUrl(conversationId: string | null) {
  const url = conversationId ? `/chat?c=${conversationId}` : "/chat";
  window.history.replaceState(null, "", url);
}

/** 對話頁:左邊是對話清單(看板頻道、群組、私訊),右邊是選到的那一間。 */
export function ChatApp({
  initialConversations,
  users,
  currentUserId,
  initialKey,
}: {
  initialConversations: ChatConversationDto[];
  users: ChatUser[];
  currentUserId: string;
  initialKey: string | null;
}) {
  const { subscribe, connected, refreshUnread } = useChat();
  const { notify, confirm, prompt } = useDialogs();
  const [conversations, setConversations] = useState(initialConversations);
  const [activeKey, setActiveKey] = useState<string | null>(
    initialKey && initialConversations.some((c) => c.key === initialKey) ? initialKey : null
  );
  const [filter, setFilter] = useState("");
  const [newDirect, setNewDirect] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [addMembers, setAddMembers] = useState(false);
  const [now] = useState(() => new Date());
  const [hits, setHits] = useState<ChatSearchHit[]>([]);
  /** 從搜尋結果點進來要跳到哪一則;nonce 讓同一則被連點兩次也會重新跳。 */
  const [jump, setJump] = useState<{ conversationKey: string; messageId: string; nonce: number } | null>(null);
  const jumpNonce = useRef(0);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    setConversations(await listMyConversations());
    refreshUnread();
  }, [refreshUnread]);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      void reload();
    }, RELOAD_DEBOUNCE_MS);
  }, [reload]);

  // 有人發言、已讀、被加進群組、推送重連:重讀清單(預覽、未讀數、新的對話)。
  useEffect(
    () =>
      subscribe((event) => {
        // 工作項留言的事件跟對話清單無關。
        if (event.type !== "comment") scheduleReload();
      }),
    [subscribe, scheduleReload]
  );

  // 推送沒連上就退回定時重讀,不讓畫面靜靜地過期。
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => void reload(), FALLBACK_RELOAD_MS);
    return () => clearInterval(timer);
  }, [connected, reload]);

  useEffect(
    () => () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    },
    []
  );

  // 標完已讀:這一列的未讀數馬上歸零(不等重讀清單),再校正一次。ChatThread 用 key 綁著對話,activeKey 在它的一生中不變。
  const onMarkedRead = useCallback(() => {
    setConversations((prev) => prev.map((c) => (c.key === activeKey && c.unread > 0 ? { ...c, unread: 0 } : c)));
    scheduleReload();
  }, [activeKey, scheduleReload]);

  // 輸入兩個字以上就連訊息內容一起搜(對話標題的篩選照舊即時)。
  useEffect(() => {
    const q = filter.trim();
    if (q.length < 2) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const found = await searchChatMessages(q);
      if (!stale) setHits(found);
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [filter]);
  const shownHits = filter.trim().length >= 2 ? hits : [];

  const active = conversations.find((c) => c.key === activeKey) ?? null;
  const others = useMemo(() => users.filter((u) => u.id !== currentUserId), [users, currentUserId]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
  }, [conversations, filter]);
  const sections = useMemo(
    () =>
      [
        { id: "DM", label: "私訊", items: visible.filter((c) => c.kind === "DM").sort(byRecent) },
        { id: "GROUP", label: "群組", items: visible.filter((c) => c.kind === "GROUP").sort(byRecent) },
        { id: "BOARD", label: "看板頻道", items: visible.filter((c) => c.kind === "BOARD").sort(byRecent) },
      ].filter((s) => s.items.length > 0),
    [visible]
  );

  /** 開一間(還沒有紀錄的看板頻道要先建起來),清單重讀之後切過去。 */
  async function goTo(conversationId: string) {
    await reload();
    setActiveKey(conversationId);
    pushUrl(conversationId);
  }

  function openHit(hit: ChatSearchHit) {
    jumpNonce.current += 1;
    setJump({ conversationKey: hit.conversationKey, messageId: hit.messageId, nonce: jumpNonce.current });
    setActiveKey(hit.conversationKey);
    pushUrl(hit.conversationKey);
  }

  async function select(c: ChatConversationDto) {
    setJump(null);
    if (c.id) {
      setActiveKey(c.key);
      pushUrl(c.id);
      return;
    }
    if (!c.boardId) return;
    const result = await openBoardChat(c.boardId);
    if (isChatError(result)) await notify(result.error);
    else await goTo(result.conversationId);
  }

  async function startDirect(userId: string) {
    const result = await openDirectChat(userId);
    if (isChatError(result)) await notify(result.error);
    else await goTo(result.conversationId);
  }

  async function startGroup(title: string, memberIds: string[]) {
    const result = await createChatGroup(title, memberIds);
    if (isChatError(result)) await notify(result.error);
    else await goTo(result.conversationId);
  }

  async function rename(c: ChatConversationDto & { id: string }) {
    const title = await prompt("聊天室名稱", { defaultValue: c.title, title: "改名" });
    if (title === null) return;
    const result = await renameChatGroup(c.id, title);
    if (result.error) await notify(result.error);
    else await reload();
  }

  async function leave(c: ChatConversationDto & { id: string }) {
    if (!(await confirm(`離開「${c.title}」?離開後就看不到這個群組的訊息了。`, { confirmLabel: "離開", danger: true }))) return;
    const result = await leaveChatGroup(c.id);
    if (result.error) {
      await notify(result.error);
      return;
    }
    setActiveKey(null);
    pushUrl(null);
    await reload();
  }

  async function add(c: ChatConversationDto & { id: string }, userIds: string[]) {
    const result = await addChatGroupMembers(c.id, userIds);
    if (result.error) await notify(result.error);
    else await reload();
  }

  const activeWithId = active && active.id ? (active as ChatConversationDto & { id: string }) : null;
  const iconButton =
    "rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

  return (
    <div className="flex h-full min-h-0 bg-white dark:bg-neutral-900">
      <aside
        className={`${activeWithId ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-neutral-200 md:w-72 dark:border-neutral-700`}
      >
        <div className="flex items-center gap-1 border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
          <h1 className="mr-auto text-sm font-semibold text-neutral-900 dark:text-neutral-100">對話</h1>
          <button type="button" className={iconButton} onClick={() => setNewDirect(true)} title="新私訊" aria-label="新私訊" data-chat-new-dm>
            <MessageSquarePlus size={16} />
          </button>
          <button type="button" className={iconButton} onClick={() => setNewGroup(true)} title="新群組" aria-label="新群組" data-chat-new-group>
            <Users size={16} />
          </button>
        </div>
        <div className="px-3 py-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="找對話或訊息…"
            className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {sections.length === 0 && shownHits.length === 0 && <p className="px-4 py-6 text-center text-xs text-neutral-400">{filter.trim() ? "沒有符合的對話或訊息。" : "沒有對話。按上面的按鈕開始。"}</p>}
          {sections.map((section) => (
            <div key={section.id}>
              <p className="px-4 pb-1 pt-3 text-[11px] font-medium text-neutral-400">{section.label}</p>
              {section.items.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  data-chat-conversation={c.key}
                  onClick={() => void select(c)}
                  className={`flex w-full items-center gap-2 px-4 py-1.5 text-left ${
                    c.key === activeKey ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  }`}
                >
                  {c.kind === "DM" ? (
                    <Avatar name={c.title} avatarUrl={c.otherAvatarUrl} size={26} />
                  ) : (
                    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200">
                      {c.kind === "BOARD" ? <Hash size={14} /> : <Users size={14} />}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={`min-w-0 flex-1 truncate text-sm ${c.unread > 0 ? "font-semibold text-neutral-900 dark:text-neutral-50" : "text-neutral-800 dark:text-neutral-100"}`}>
                        {c.title}
                      </span>
                      {c.lastMessageAt && (
                        <span className="shrink-0 text-[10px] text-neutral-400">
                          {dayKey(c.lastMessageAt) === dayKey(now.toISOString()) ? clockLabel(c.lastMessageAt) : dayLabel(c.lastMessageAt, now)}
                        </span>
                      )}
                    </span>
                    {c.lastPreview && <span className="block truncate text-[11px] text-neutral-500 dark:text-neutral-400">{c.lastPreview}</span>}
                  </span>
                  {c.unread > 0 && (
                    <span
                      data-chat-conversation-unread
                      className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white"
                    >
                      {c.unread > 99 ? "99+" : c.unread}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {shownHits.length > 0 && (
            <div>
              <p className="px-4 pb-1 pt-3 text-[11px] font-medium text-neutral-400">訊息({shownHits.length}{shownHits.length >= 30 ? "+" : ""})</p>
              {shownHits.map((hit) => (
                <button
                  key={hit.messageId}
                  type="button"
                  data-chat-hit={hit.messageId}
                  onClick={() => openHit(hit)}
                  className="block w-full px-4 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800 dark:text-neutral-100">
                      {hit.conversationTitle}・{hit.authorName}
                    </span>
                    <span className="shrink-0 text-[10px] text-neutral-400">{dayLabel(hit.createdAt, now)}</span>
                  </span>
                  <span className="block truncate text-[11px] text-neutral-500 dark:text-neutral-400">{hit.excerpt}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className={`${activeWithId ? "flex" : "hidden md:flex"} min-w-0 flex-1`}>
        {activeWithId ? (
          <ChatThread
            key={`${activeWithId.id}:${jump?.conversationKey === activeWithId.key ? jump.nonce : 0}`}
            jumpToMessageId={jump?.conversationKey === activeWithId.key ? jump.messageId : null}
            conversation={activeWithId}
            users={users}
            currentUserId={currentUserId}
            onMarkedRead={onMarkedRead}
            onBack={() => {
              setActiveKey(null);
              pushUrl(null);
            }}
            actions={
              activeWithId.kind === "GROUP" ? (
                <div className="flex items-center gap-1">
                  <button type="button" className={iconButton} title="加成員" aria-label="加成員" onClick={() => setAddMembers(true)}>
                    <UserPlus size={15} />
                  </button>
                  <button type="button" className={iconButton} title="改名" aria-label="改名" onClick={() => void rename(activeWithId)}>
                    <Pencil size={15} />
                  </button>
                  <button type="button" className={iconButton} title="離開群組" aria-label="離開群組" onClick={() => void leave(activeWithId)}>
                    <LogOut size={15} />
                  </button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">選一個對話,或開一個新的。</div>
        )}
      </section>

      <NewDirectChatDialog open={newDirect} onOpenChange={setNewDirect} users={others} onPick={(id) => void startDirect(id)} />
      <NewGroupChatDialog open={newGroup} onOpenChange={setNewGroup} users={others} onCreate={(t, ids) => void startGroup(t, ids)} />
      {activeWithId && (
        <AddMembersDialog
          open={addMembers}
          onOpenChange={setAddMembers}
          candidates={others.filter((u) => !activeWithId.memberIds.includes(u.id))}
          onAdd={(ids) => void add(activeWithId, ids)}
        />
      )}
    </div>
  );
}
