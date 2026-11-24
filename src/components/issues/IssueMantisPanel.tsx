"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, RefreshCw, Send } from "lucide-react";
import { createInMantisAction, linkToMantisAction, syncCaseNowAction } from "@/lib/actions/issueMantis";
import type { IssueCaseDetail } from "@/lib/issueTypes";
import { actionErrorMessage } from "@/lib/userError";
import { useDialogs } from "@/components/ui/DialogProvider";
import { buttonClass, inputClass } from "./issueUi";

/**
 * 案件的 Mantis 區塊:已連到 Mantis 就顯示單號連結與「立即同步這筆」;還沒連就可以「建立到 Mantis」
 * 或「連結既有 Mantis 單」(輸入單號)。沒有啟用中的 Mantis 連線就不顯示。
 */
export function IssueMantisPanel({ caseId, mantis }: { caseId: string; mantis: IssueCaseDetail["mantis"] }) {
  const router = useRouter();
  const { confirm, notify } = useDialogs();
  const [linkText, setLinkText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!mantis.connected && mantis.id === null) return null;

  async function run(fn: () => Promise<{ error?: string; warnings?: string[]; updated?: boolean }>, success: (r: { warnings?: string[]; updated?: boolean }) => string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      if (r.error) {
        setMessage({ ok: false, text: r.error });
        return;
      }
      if (r.warnings?.length) await notify(r.warnings.join("\n"), { title: "Mantis" });
      setMessage({ ok: true, text: success(r) });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: actionErrorMessage(err, "操作失敗") });
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const ok = await confirm("要把這個案件建立成 Mantis 的問題單嗎?建立後會連在一起,之後的修改依「寫回」設定同步。", { title: "建立到 Mantis", confirmLabel: "建立" });
    if (ok) await run(() => createInMantisAction(caseId), () => "已建立到 Mantis");
  }

  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900" data-testid="issue-mantis" data-issue-mantis>
      <h2 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Mantis</h2>
      {mantis.id !== null ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {mantis.url ? (
              <a href={mantis.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline dark:text-blue-400" data-testid="mantis-link">
                Mantis #{mantis.id} <ExternalLink size={12} />
              </a>
            ) : (
              <span data-testid="mantis-link">Mantis #{mantis.id}</span>
            )}
            {mantis.canUse && (
              <button type="button" disabled={busy} onClick={() => void run(() => syncCaseNowAction(caseId), (r) => (r.updated ? "已從 Mantis 更新" : "Mantis 上沒有新的變動"))} className={buttonClass} data-testid="mantis-sync">
                <RefreshCw size={13} /> 立即同步這筆
              </button>
            )}
          </div>
          {!mantis.connected && <p className="text-xs text-neutral-400">Mantis 連線目前停用中,不會同步也不會寫回。</p>}
        </div>
      ) : mantis.canUse ? (
        <div className="space-y-2">
          <button type="button" disabled={busy} onClick={() => void create()} className={buttonClass} data-testid="mantis-create">
            <Send size={13} /> 建立到 Mantis
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Mantis 單號(例如 123)" inputMode="numeric" className={`${inputClass} w-44`} data-testid="mantis-link-input" />
            <button type="button" disabled={busy || !linkText.trim()} onClick={() => void run(() => linkToMantisAction(caseId, Number(linkText.replace(/\D/g, ""))), () => "已連結")} className={buttonClass} data-testid="mantis-link-submit">
              <Link2 size={13} /> 連結既有 Mantis 單
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-neutral-400">還沒有連到 Mantis。只有管理者與負責的處理人可以建立或連結。</p>
      )}
      {message && (
        <div className={`mt-2 rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} role="alert" data-testid="mantis-message">
          {message.text}
        </div>
      )}
    </section>
  );
}
