"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Download, ExternalLink } from "lucide-react";
import { setFeedbackStatus, type FeedbackRow } from "@/lib/actions/feedback";
import { FEEDBACK_STATUS_LABELS, feedbackCsv } from "@/lib/feedback";
import { manualHref } from "@/lib/helpTopics";
import { useDialogs } from "@/components/ui/DialogProvider";
import { actionErrorMessage } from "@/lib/userError";

type Filter = "OPEN" | "RESOLVED" | "ALL";

const TABS: { key: Filter; label: string }[] = [
  { key: "OPEN", label: "未處理" },
  { key: "RESOLVED", label: "已處理" },
  { key: "ALL", label: "全部" },
];

/** 管理者頁:同仁送出的回報。看是誰、在哪個畫面、寫了什麼;處理完標成已處理(可以留說明);可以下載 CSV。 */
export function FeedbackList({ rows }: { rows: FeedbackRow[] }) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = { OPEN: rows.filter((r) => r.status === "OPEN").length, RESOLVED: rows.filter((r) => r.status === "RESOLVED").length, ALL: rows.length };
  const shown = filter === "ALL" ? rows : rows.filter((r) => r.status === filter);

  async function change(row: FeedbackRow, status: "OPEN" | "RESOLVED") {
    setBusyId(row.id);
    try {
      const result = await setFeedbackStatus(row.id, status, notes[row.id] ?? row.adminNote ?? "");
      if (result.error) {
        await notify(result.error, { title: "無法儲存" });
        return;
      }
      router.refresh();
    } catch (err) {
      await notify(actionErrorMessage(err, "儲存失敗"), { title: "無法儲存" });
    } finally {
      setBusyId(null);
    }
  }

  function download() {
    // 前面加 BOM,Excel 才會把這個檔案當 UTF-8 開(不然中文會亂碼)。
    const blob = new Blob(["﻿" + feedbackCsv(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `使用者回報_${TABS.find((t) => t.key === filter)!.label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div data-feedback-list>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-neutral-200 text-sm dark:border-neutral-700">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              data-feedback-tab={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 ${filter === t.key ? "bg-blue-600 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"}`}
            >
              {t.label} {counts[t.key]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={download}
          disabled={shown.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          <Download size={12} /> 下載 CSV
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
          {filter === "OPEN" ? "沒有未處理的回報。" : "沒有回報。"}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => (
            <li key={r.id} data-feedback-row={r.id} className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{r.userName}</span>
                <span>{r.userEmail}</span>
                <span className="tabular-nums">{r.createdAt}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    r.status === "OPEN" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  }`}
                >
                  {FEEDBACK_STATUS_LABELS[r.status]}
                </span>
              </div>

              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-800 dark:text-neutral-100">{r.message}</p>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="text-neutral-500 dark:text-neutral-400">畫面:{r.pageLabel}</span>
                <Link href={r.path} target="_blank" className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-300">
                  <ExternalLink size={11} /> 開啟該畫面
                </Link>
                <a href={manualHref(r.manualAnchor)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-300">
                  <BookOpen size={11} /> 對應的手冊章節
                </a>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <input
                  value={notes[r.id] ?? r.adminNote ?? ""}
                  onChange={(e) => setNotes((cur) => ({ ...cur, [r.id]: e.target.value }))}
                  placeholder="處理說明(選填,例如「已改好」「手冊第 14 章有寫」)"
                  maxLength={1000}
                  data-feedback-note
                  className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-600"
                />
                {r.status === "OPEN" ? (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void change(r, "RESOLVED")}
                    data-feedback-resolve
                    className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    標為已處理
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void change(r, "OPEN")}
                    data-feedback-reopen
                    className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    重新開啟
                  </button>
                )}
              </div>
              {r.status === "RESOLVED" && r.resolvedAt && (
                <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                  {r.resolvedByName ?? "管理者"} 於 {r.resolvedAt} 處理
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
