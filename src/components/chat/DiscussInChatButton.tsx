"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { openBoardChat } from "@/lib/actions/chat";
import { useDialogs } from "@/components/ui/DialogProvider";
import { chatRefParam } from "@/lib/chatRefMention";
import type { RefKind } from "@/lib/chatLinks";
import { knownErrorMessage } from "@/lib/userError";

/**
 * 「在對話中討論」:跳到這個看板的頻道,輸入框已經帶好 #這個項目 與連結,直接打字留言就好。
 * 工作項、風險、議題、問題的視窗都放一顆。頻道還沒開過會先開起來。
 */
export function DiscussInChatButton({ boardId, kind, id }: { boardId: string; kind: RefKind; id: string }) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [busy, setBusy] = useState(false);

  async function go() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await openBoardChat(boardId);
      if ("error" in result && result.error) {
        await notify(result.error, { title: "無法開啟對話" });
        return;
      }
      if (!("conversationId" in result)) return;
      router.push(`/chat?c=${result.conversationId}&ref=${encodeURIComponent(chatRefParam(kind, id))}`);
    } catch (err) {
      await notify(knownErrorMessage(err, "沒有成功開啟對話。請確認你有這個看板的權限。"), { title: "無法開啟對話" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void go()}
      disabled={busy}
      data-discuss-in-chat
      title="到這個看板的對話頻道留言,輸入框會帶好這一項的引用"
      className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <MessageCircle size={13} />
      {busy ? "開啟中…" : "在對話中討論"}
    </button>
  );
}
