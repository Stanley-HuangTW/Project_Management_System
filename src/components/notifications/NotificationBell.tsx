"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell, Settings } from "lucide-react";
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/actions/notification";
import { NotificationPreferencesModal } from "./NotificationPreferencesModal";
import { NOTIFICATION_TYPE_STYLES as NOTIFICATION_TYPE } from "./typeStyles";

function formatWhen(value: Date | string): string {
  const date = new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} 小時前`;
  return date.toLocaleDateString("zh-TW");
}

const POLL_INTERVAL_MS = 30000;

/** A value that's different on every click, even for the same notification
 *  clicked twice in a row — see handleClickNotification's use of it. Pulled
 *  out of the component body because Date.now() is an impure call the
 *  react-hooks/purity rule flags anywhere inside render-reachable code. */
function nonce(): string {
  return String(Date.now());
}

export function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<
    Awaited<ReturnType<typeof listNotifications>>
  >([]);
  const [open, setOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    getUnreadCount().then(setUnreadCount);
    const interval = setInterval(() => {
      getUnreadCount().then(setUnreadCount);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setNotifications(await listNotifications());
    }
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }

  async function handleClickNotification(
    n: Awaited<ReturnType<typeof listNotifications>>[number]
  ) {
    if (!n.read) {
      await markNotificationRead(n.id);
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    // 對話的通知:去那間對話(沒有看板、工作項可跳)。
    if (n.conversationId) {
      router.push(`/chat?c=${n.conversationId}`);
      return;
    }
    // highlightAt changes on every click, even re-clicking the same
    // notification twice — the board page's "open the item card" logic keys
    // off it rather than just the item id, since the id alone is identical
    // both times and wouldn't look like a new click at all.
    // 風險/問題被指派的通知沒有工作項:直接開那個看板的風險分頁。
    router.push(
      n.item
        ? `/boards/${n.boardId}?highlight=${n.item.id}&highlightAt=${nonce()}`
        : `/boards/${n.boardId}?view=risks&highlightAt=${nonce()}`
    );
    // A search-param-only navigation to a route you're already on can be
    // served from the client Router Cache without re-running the page's
    // searchParams-dependent data fetch — force it, or clicking a second
    // notification while already on the target board silently does nothing.
    router.refresh();
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="relative rounded p-1.5 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
          aria-label="通知"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          className="z-50 max-h-96 w-96 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1 shadow-md"
          onWheel={(e) => {
            e.stopPropagation();
            e.currentTarget.scrollTop += e.deltaY;
          }}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs text-neutral-400 dark:text-neutral-500">通知</span>
            <span className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  全部標為已讀
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  setPreferencesOpen(true);
                }}
                title="通知設定"
                aria-label="通知設定"
                className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-100"
              >
                <Settings size={13} />
              </button>
            </span>
          </div>
          {notifications.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-neutral-400 dark:text-neutral-500">
              沒有通知
            </p>
          )}
          {notifications.map((n) => {
            const kind = NOTIFICATION_TYPE[n.type] ?? {
              label: n.type,
              className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
            };
            return (
              <DropdownMenu.Item
                key={n.id}
                onSelect={() => handleClickNotification(n)}
                className={`flex cursor-pointer flex-col gap-1 rounded px-3 py-2 text-sm outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  n.read ? "opacity-60" : ""
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${kind.className}`}>
                    {kind.label}
                  </span>
                  <span className="min-w-0 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                    {n.boardName}
                    <span className="mx-1">›</span>
                    {n.groupName}
                  </span>
                </span>

                {n.title && (
                <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                  {n.wbsCode && (
                    <span className="mr-1.5 font-normal text-neutral-400 dark:text-neutral-500 tabular-nums">
                      {n.wbsCode}
                    </span>
                  )}
                  {n.title}
                  {n.trashed && (
                    <span className="ml-1.5 text-[10px] font-normal text-neutral-400 dark:text-neutral-500">
                      (在垃圾桶)
                    </span>
                  )}
                </span>
                )}

                <span className="text-xs text-neutral-600 dark:text-neutral-300">{n.message}</span>

                <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                  {n.actorName ? `${n.actorName}・` : ""}
                  {formatWhen(n.createdAt)}
                </span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
      <NotificationPreferencesModal open={preferencesOpen} onOpenChange={setPreferencesOpen} />
    </DropdownMenu.Root>
  );
}
