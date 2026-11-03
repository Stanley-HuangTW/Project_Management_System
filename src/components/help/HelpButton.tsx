"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { BookOpen, CheckCircle2, HelpCircle, Search, Send } from "lucide-react";
import { submitFeedback } from "@/lib/actions/feedback";
import { FEEDBACK_MAX_LENGTH } from "@/lib/feedback";
import { helpTopicFor, manualHref } from "@/lib/helpTopics";
import { actionErrorMessage } from "@/lib/userError";
import { useCurrentHelpHint } from "./helpHint";

/**
 * 每個畫面右下角的「?」:不知道怎麼用就開使用手冊裡這個畫面對應的那一章(新分頁,不換掉手上的畫面);
 * 對不上就搜尋手冊;還是不懂,把問題寫下來送給管理者——系統自動附上是誰、在哪個畫面。
 */
export function HelpButton({ isAdmin, impersonating }: { isAdmin: boolean; impersonating: boolean }) {
  const pathname = usePathname();
  const hint = useCurrentHelpHint();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const topic = helpTopicFor(pathname, hint, isAdmin);
  // 對話頁的輸入框在右下角,「送出」鈕就在按鈕原本的位置:往上移一點,不要蓋住它。
  const aboveComposer = pathname === "/chat" || pathname.startsWith("/chat/");

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await submitFeedback({
        message,
        // 送出當下的網址(含查詢字串),管理者點「開啟該畫面」回到同一個位置。
        path: `${window.location.pathname}${window.location.search}`,
        pageLabel: topic.label,
        manualAnchor: topic.anchor,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage("");
      setSent(true);
    } catch (err) {
      setError(actionErrorMessage(err, "送出失敗,請稍後再試"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSent(false);
          setError(null);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          data-help-button
          aria-label="說明與問題回報"
          title="不知道怎麼用?有問題?"
          className={`fixed ${aboveComposer ? "bottom-24" : "bottom-4"} right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 print:hidden`}
        >
          <HelpCircle size={22} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          data-help-popover
          className="z-50 w-80 rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        >
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">不知道怎麼用?有疑問?</p>

          <a
            href={manualHref(topic.anchor)}
            target="_blank"
            rel="noopener noreferrer"
            data-help-manual-link
            className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 font-medium text-blue-800 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
          >
            <BookOpen size={16} className="shrink-0" />
            <span className="min-w-0">
              開啟使用手冊:{topic.label}
              <span className="block text-[11px] font-normal text-blue-700/80 dark:text-blue-300/80">在新分頁打開,你手上的畫面不會被換掉</span>
            </span>
          </a>

          <form action="/manual" method="get" target="_blank" className="mt-2 flex items-center gap-1.5 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-600">
            <Search size={14} className="shrink-0 text-neutral-400" />
            <input
              name="q"
              minLength={2}
              required
              placeholder="搜尋使用手冊…"
              data-help-search
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
          </form>

          <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-700">
            <p className="mb-1 text-xs font-medium text-neutral-700 dark:text-neutral-200">手冊還是看不懂,或遇到不對勁的地方?寫下來給管理者</p>
            {sent ? (
              <p data-help-sent className="flex items-start gap-1.5 rounded-md bg-emerald-50 px-2 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircle2 size={14} className="mt-px shrink-0" />
                已送出,謝謝!管理者會看到,系統也記下了你是在「{topic.label}」這個畫面送的。
              </p>
            ) : (
              <>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy || impersonating}
                  rows={4}
                  maxLength={FEEDBACK_MAX_LENGTH + 200}
                  placeholder={impersonating ? "代操作別人的帳號時不能送出回報" : `例如:我想把……,但是按了沒反應(畫面:${topic.label})`}
                  data-help-message
                  className="w-full resize-none rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-60 dark:border-neutral-600"
                />
                {error && <p data-help-error className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                    自動附上:你是誰、「{topic.label}」
                    {message.length > FEEDBACK_MAX_LENGTH && <span className="ml-1 text-red-600">超過 {FEEDBACK_MAX_LENGTH} 字</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={busy || impersonating || !message.trim()}
                    data-help-send
                    className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Send size={12} /> {busy ? "送出中..." : "送出給管理者"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
