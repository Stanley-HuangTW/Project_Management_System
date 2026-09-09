"use client";

import { splitMentions, type MentionCandidate } from "@/lib/mentions";

/**
 * A comment body with its @-mentions picked out. Rendered as React nodes
 * rather than by setting HTML, so a comment can never inject markup.
 */
export function MentionText({ body, users }: { body: string; users: MentionCandidate[] }) {
  return (
    <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-100">
      {splitMentions(body, users).map((segment, i) =>
        segment.kind === "mention" ? (
          <span
            key={i}
            className="rounded bg-blue-100 px-1 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          >
            {segment.text}
          </span>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </p>
  );
}
