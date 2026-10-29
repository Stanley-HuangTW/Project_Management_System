"use client";

import { splitMentions, type MentionCandidate } from "@/lib/mentions";
import { splitRefs } from "@/lib/chatRefMention";

/**
 * 一則對話訊息的內文:@提到的人畫成藍底,#引用的工作項 / 風險 / 議題畫成可以點的連結(新分頁開到那個項目)。
 * 全部用 React 節點畫,不會把使用者打的字當 HTML。
 */
export function ChatMessageBody({ body, links, users }: { body: string; links: { url: string; label: string }[]; users: MentionCandidate[] }) {
  return (
    <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-100">
      {splitRefs(body, links).map((part, i) =>
        part.kind === "ref" ? (
          <a
            key={i}
            href={part.url}
            target="_blank"
            rel="noreferrer"
            data-chat-ref
            className="rounded bg-indigo-50 px-1 font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
          >
            {part.text}
          </a>
        ) : (
          splitMentions(part.text, users).map((segment, j) =>
            segment.kind === "mention" ? (
              <span key={`${i}-${j}`} className="rounded bg-blue-100 px-1 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {segment.text}
              </span>
            ) : (
              <span key={`${i}-${j}`}>{segment.text}</span>
            )
          )
        )
      )}
    </p>
  );
}
