"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { BookOpen, CheckCircle2, Crosshair, Search, Send } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { submitFeedback } from "@/lib/actions/feedback";
import { FEEDBACK_MAX_LENGTH } from "@/lib/feedback";
import type { FeedbackContext } from "@/lib/feedbackContext";
import { helpTopicFor, helpTopicForElement, manualHref, type HelpTopic } from "@/lib/helpTopics";
import { actionErrorMessage } from "@/lib/userError";
import { registerElementPicker, startElementPicker, stopElementPicker, useElementPicking } from "./pickerState";
import { useCurrentHelpHint } from "./helpHint";
import { capturePickedElement, manualQueryOf, pickTarget } from "./pickElement";

type Picked = {
  context: FeedbackContext;
  /** 整個畫面的手冊章節。 */
  pageTopic: HelpTopic;
  /** 選到的那個地方有自己的章節才有。 */
  elementTopic: HelpTopic | null;
  /** 拿元素上的文字搜尋手冊的關鍵字。 */
  query: string | null;
  /** 選的當下的網址(路徑與查詢字串)。 */
  path: string;
};

/** 給使用者看的元素種類。 */
function kindOf(tag: string): string {
  if (tag === "button") return "按鈕";
  if (tag === "a") return "連結";
  if (["input", "textarea", "select"].includes(tag)) return "輸入欄位";
  if (tag === "img") return "圖片";
  if (tag === "svg") return "圖示";
  if (tag === "th") return "表格標題";
  if (tag === "td") return "表格儲存格";
  if (tag === "li") return "清單項目";
  if (/^h[1-6]$/.test(tag)) return "標題";
  return "區塊";
}

const ZOOM = 2147482999;

/**
 * 「選取元素」:在畫面上點一個地方,然後選擇「查使用手冊」(開那個地方對應的章節,或拿上面的字搜尋手冊)
 * 或「回報問題」(寫下問題,系統自動附上選到的元素的位置資訊,給管理者交給 Claude Code 除錯)。
 *
 * 選取模式靠 window 上的捕捉階段監聽:滑鼠點下去、放開的事件在抵達畫面上的元素之前就被攔住,
 * 所以點到的按鈕不會真的被按下去、Radix 的對話視窗也不會因為「點到外面」而關掉。
 */
export function ElementPicker({ isAdmin, impersonating }: { isAdmin: boolean; impersonating: boolean }) {
  const pathname = usePathname();
  const hint = useCurrentHelpHint();
  const picking = useElementPicking();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [tab, setTab] = useState<"manual" | "report">("manual");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  // 事件監聽只在選取模式開始時掛一次,要讀到的是「現在」的畫面狀態。
  const latest = useRef({ pathname, hint, isAdmin });
  useEffect(() => {
    latest.current = { pathname, hint, isAdmin };
  }, [pathname, hint, isAdmin]);

  useEffect(() => registerElementPicker(), []);

  useEffect(() => {
    if (!picking) return;

    const style = document.createElement("style");
    style.setAttribute("data-picker-ui", "");
    style.textContent = "html, html * { cursor: crosshair !important; } [data-picker-ui], [data-picker-ui] * { cursor: default !important; }";
    document.head.append(style);

    const ours = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-picker-ui]");
    // 「?」按鈕與它的小視窗不選:選取是要選畫面上的東西。
    const targetFrom = (t: EventTarget | null): Element | null =>
      t instanceof Element && !ours(t) && !t.closest("[data-help-button], [data-help-popover]") ? pickTarget(t) : null;

    let last = { x: -1, y: -1 };
    function show(el: Element | null) {
      const box = boxRef.current;
      const chip = chipRef.current;
      if (!box || !chip) return;
      if (!el) {
        box.style.display = "none";
        chip.style.display = "none";
        return;
      }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      const tag = el.tagName.toLowerCase();
      const label = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 40);
      chip.textContent = label ? `${tag}「${label}」` : tag;
      chip.style.display = "block";
      chip.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 300))}px`;
      chip.style.top = `${r.top > 28 ? r.top - 24 : r.bottom + 4}px`;
    }
    const refresh = () => {
      if (last.x >= 0) show(targetFrom(document.elementFromPoint(last.x, last.y)));
    };
    const onMove = (e: MouseEvent) => {
      last = { x: e.clientX, y: e.clientY };
      refresh();
    };
    // 點下去、放開都攔住:不要讓畫面上的東西真的被按到,也不要讓 Radix 把對話視窗當成「點到外面」關掉。
    const swallow = (e: Event) => {
      e.stopPropagation();
      if (!ours(e.target)) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (ours(e.target)) return; // 取消鈕照常運作
      e.preventDefault();
      e.stopPropagation();
      const el = targetFrom(e.target);
      if (el) finish(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      stopElementPicker();
    };

    function finish(el: Element) {
      const { pathname: path, hint: view, isAdmin: admin } = latest.current;
      const context: FeedbackContext = {
        element: capturePickedElement(el),
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        userAgent: navigator.userAgent,
        ...(view ? { hint: view } : {}),
      };
      setPicked({
        context,
        pageTopic: helpTopicFor(path, view, admin),
        elementTopic: helpTopicForElement((selector) => !!el.closest(selector), admin),
        query: manualQueryOf(el),
        path: `${window.location.pathname}${window.location.search}`,
      });
      setTab("manual");
      setMessage("");
      setError(null);
      setSent(false);
      stopElementPicker();
    }

    const swallowed = ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "contextmenu"];
    window.addEventListener("mousemove", onMove, true);
    for (const type of swallowed) window.addEventListener(type, swallow, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("mousemove", onMove, true);
      for (const type of swallowed) window.removeEventListener(type, swallow, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
      style.remove();
    };
  }, [picking]);

  async function send() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitFeedback({
        message,
        path: picked.path,
        pageLabel: picked.pageTopic.label,
        manualAnchor: (picked.elementTopic ?? picked.pageTopic).anchor,
        context: picked.context,
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

  const element = picked?.context.element;
  const topic = picked ? (picked.elementTopic ?? picked.pageTopic) : null;
  const summary = element ? (element.label ? `${kindOf(element.tag)}「${element.label}」` : element.text ? `${kindOf(element.tag)}「${element.text.slice(0, 40)}」` : `${kindOf(element.tag)}(沒有文字)`) : "";

  return (
    <>
      {picking &&
        createPortal(
          <>
            <div
              data-picker-ui
              data-picker-banner
              style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: ZOOM + 1, pointerEvents: "auto" }}
              className="flex items-center gap-3 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-xl"
            >
              <Crosshair size={16} className="shrink-0" />
              選取模式:點一下你要詢問或回報的地方
              <button type="button" data-picker-cancel onClick={stopElementPicker} className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs hover:bg-white/25">
                取消(Esc)
              </button>
            </div>
            <div
              ref={boxRef}
              data-picker-ui
              data-picker-box
              style={{ position: "fixed", display: "none", zIndex: ZOOM, pointerEvents: "none", border: "2px solid #2563eb", background: "rgba(37,99,235,.14)", borderRadius: 4 }}
            />
            <div
              ref={chipRef}
              data-picker-ui
              data-picker-chip
              style={{ position: "fixed", display: "none", zIndex: ZOOM, pointerEvents: "none", maxWidth: 300 }}
              className="truncate rounded bg-blue-600 px-2 py-0.5 text-xs text-white shadow"
            />
          </>,
          document.body
        )}

      <Modal open={picked !== null} onOpenChange={(open) => !open && setPicked(null)} title="選取的地方" size="md">
        {picked && element && topic && (
          <div className="space-y-3 text-sm" data-picker-result>
            <div className="rounded-md bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">你選的是</p>
              <p data-picker-summary className="break-words font-medium text-neutral-900 dark:text-neutral-100">
                {summary}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">在「{picked.pageTopic.label}」這個畫面</p>
              <details className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                <summary className="cursor-pointer">回報時會自動附上的位置資訊</summary>
                <code data-picker-selector className="mt-1 block break-all text-[11px]">{element.selector}</code>
              </details>
            </div>

            <div className="flex overflow-hidden rounded-md border border-neutral-200 text-sm dark:border-neutral-700" role="tablist">
              {(
                [
                  ["manual", "查使用手冊"],
                  ["report", "回報問題"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  data-picker-tab={key}
                  onClick={() => setTab(key)}
                  className={`flex-1 px-3 py-1.5 ${tab === key ? "bg-blue-600 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "manual" ? (
              <div className="space-y-2">
                <a
                  href={manualHref(topic.anchor)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-picker-manual-link
                  className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 font-medium text-blue-800 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
                >
                  <BookOpen size={16} className="shrink-0" />
                  <span className="min-w-0">
                    開啟使用手冊:{topic.label}
                    <span className="block text-[11px] font-normal text-blue-700/80 dark:text-blue-300/80">在新分頁打開,你手上的畫面不會被換掉</span>
                  </span>
                </a>
                {picked.elementTopic && picked.elementTopic.anchor !== picked.pageTopic.anchor && (
                  <a
                    href={manualHref(picked.pageTopic.anchor)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-picker-page-link
                    className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <BookOpen size={14} className="shrink-0 text-neutral-400" />
                    整個畫面的說明:{picked.pageTopic.label}
                  </a>
                )}
                {picked.query && (
                  <a
                    href={`/manual?q=${encodeURIComponent(picked.query)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-picker-search-link
                    className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <Search size={14} className="shrink-0 text-neutral-400" />
                    用「{picked.query}」搜尋手冊
                  </a>
                )}
                <p className="text-xs text-neutral-400 dark:text-neutral-500">手冊看了還是不懂,切到「回報問題」寫下來給管理者。</p>
              </div>
            ) : sent ? (
              <p data-picker-sent className="flex items-start gap-1.5 rounded-md bg-emerald-50 px-2 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircle2 size={14} className="mt-px shrink-0" />
                已送出,謝謝!管理者會看到你選的地方與你寫的說明。
              </p>
            ) : (
              <div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy || impersonating}
                  rows={4}
                  maxLength={FEEDBACK_MAX_LENGTH + 200}
                  placeholder={impersonating ? "代操作別人的帳號時不能送出回報" : `這個地方有什麼問題?例如:按了沒反應、顯示的數字不對、不知道這是做什麼的…`}
                  data-picker-message
                  className="w-full resize-none rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-60 dark:border-neutral-600"
                />
                {error && <p data-picker-error className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                    自動附上:你是誰、選到的地方、畫面與瀏覽器大小
                    {message.length > FEEDBACK_MAX_LENGTH && <span className="ml-1 text-red-600">超過 {FEEDBACK_MAX_LENGTH} 字</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={busy || impersonating || !message.trim()}
                    data-picker-send
                    className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Send size={12} /> {busy ? "送出中..." : "送出給管理者"}
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end border-t border-neutral-100 pt-2 dark:border-neutral-800">
              <button
                type="button"
                data-picker-again
                onClick={() => {
                  setPicked(null);
                  // 等對話視窗收起來、焦點放掉,再開始選。
                  setTimeout(startElementPicker, 150);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <Crosshair size={12} /> 重新選取
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
