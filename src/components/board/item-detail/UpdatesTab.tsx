"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import type { UserOption } from "@/types/board";
import { createComment, listComments, setCommentInWeeklyReport } from "@/lib/actions/comment";
import { useDialogs } from "@/components/ui/DialogProvider";
import { canManageStructure } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";
import { activeMentionQuery } from "@/lib/mentions";
import { MentionText } from "./MentionText";

export function UpdatesTab({
  boardId,
  itemId,
  users,
  currentUserId,
  userRole,
}: {
  boardId: string;
  itemId: string;
  /** For the @ picker and for highlighting mentions in existing comments. */
  users: UserOption[];
  /** 週報勾選:只有寫這則更新的人、主管與管理者可以改。 */
  currentUserId: string;
  userRole: UserRole;
}) {
  const { notify } = useDialogs();
  // 這則更新要不要彙整進週報——預設要;送出之後下一則又回到預設。
  const [inWeekly, setInWeekly] = useState(true);
  const [comments, setComments] = useState<Awaited<ReturnType<typeof listComments>>>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  // Which "@" the user dismissed with Escape, so it stays dismissed while
  // they keep typing after it.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // Resources (tools, vendors) can be a 負責人 but have no account, so there
  // is nobody to notify — they are not mentionable.
  const mentionable = users.filter((u) => !u.isResource);
  const query = activeMentionQuery(body, caret);
  const matches =
    query && query.at !== dismissedAt
      ? mentionable
          .filter((u) => u.name.toLowerCase().includes(query.query.toLowerCase()))
          .slice(0, 6)
      : [];
  const active = matches[Math.min(highlight, matches.length - 1)];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await listComments(itemId);
        if (!cancelled) setComments(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  function insertMention(name: string) {
    if (!query) return;
    const next = `${body.slice(0, query.at)}@${name} ${body.slice(caret)}`;
    const position = query.at + name.length + 2;
    setBody(next);
    setCaret(position);
    setHighlight(0);
    // After React has written the new value, or the caret jumps to the end.
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (active) {
        e.preventDefault();
        insertMention(active.name);
      }
    } else if (e.key === "Escape") {
      // Otherwise Escape closes the whole item card while the user only
      // meant to dismiss the picker.
      e.preventDefault();
      e.stopPropagation();
      setDismissedAt(query?.at ?? null);
    }
  }

  async function toggleWeekly(commentId: string, value: boolean) {
    setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, inWeeklyReport: value } : c)));
    const result = await setCommentInWeeklyReport(itemId, commentId, value);
    if (result.error) {
      setComments(await listComments(itemId));
      await notify(result.error, { title: "無法更改" });
    }
  }

  async function handleSubmit() {
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      await createComment(boardId, itemId, body.trim(), inWeekly);
      setComments(await listComments(itemId));
      setBody("");
      setInWeekly(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="relative">
        <textarea
          ref={textarea}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setCaret(e.target.selectionStart);
            setHighlight(0);
            setDismissedAt(null);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart)}
          placeholder="新增更新... (輸入 @ 提及成員)"
          rows={3}
          className="mb-2 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        {matches.length > 0 && (
          <ul className="absolute left-2 top-full z-20 -mt-1 max-h-56 w-56 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 py-1 shadow-lg">
            {matches.map((user, i) => (
              <li key={user.id}>
                <button
                  type="button"
                  // onMouseDown, not onClick: a click would blur the textarea
                  // first and take the caret with it.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(user.name);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
                    user.id === active?.id
                      ? "bg-blue-50 dark:bg-blue-950"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-700"
                  }`}
                >
                  <Avatar name={user.name} avatarUrl={user.avatarUrl} size={20} />
                  <span className="truncate text-neutral-700 dark:text-neutral-100">{user.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mb-5 flex items-center justify-end gap-3">
        <label
          className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300"
          title="勾選:這則更新會彙整進週報(預設勾選)"
        >
          <input
            type="checkbox"
            checked={inWeekly}
            onChange={(e) => setInWeekly(e.target.checked)}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          更新至週報
        </label>
        <button
          type="button"
          disabled={submitting || !body.trim()}
          onClick={handleSubmit}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "送出中..." : "更新"}
        </button>
      </div>

      <div className="space-y-4">
        {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>}
        {!loading && comments.length === 0 && (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">還沒有更新</p>
        )}
        {[...comments].reverse().map((c) => (
          <div key={c.id} className="flex gap-3">
            <Avatar name={c.author.name} avatarUrl={c.author.avatarUrl} size={32} />
            <div className="min-w-0 flex-1 border-b border-neutral-100 dark:border-neutral-700 pb-4">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{c.author.name}</span>
                <span className="text-xs text-neutral-400 dark:text-neutral-500">
                  {new Date(c.createdAt).toLocaleString("zh-TW")}
                </span>
                <span className="ml-auto">
                  <label
                className={`flex shrink-0 items-center gap-1 text-[11px] ${!(c.author.id === currentUserId || canManageStructure(userRole)) ? "text-neutral-300 dark:text-neutral-600" : "cursor-pointer text-neutral-500 dark:text-neutral-400"}`}
                title={!(c.author.id === currentUserId || canManageStructure(userRole)) ? "只有寫這一筆的人、主管與管理者可以改" : "勾選:這一筆的資訊會彙整進週報"}
              >
                <input type="checkbox" checked={c.inWeeklyReport} disabled={!(c.author.id === currentUserId || canManageStructure(userRole))} onChange={(e) => toggleWeekly(c.id, e.target.checked)} className="h-3 w-3 accent-blue-600" />
                週報
              </label>
                </span>
              </div>
              <MentionText body={c.body} users={mentionable} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
