"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isoWeekLabel } from "@/lib/weeklyReport";

export type WeeklyReportRow = {
  weekStart: string;
  weekEnd: string;
  markdown: string;
  createdAt: string;
};

/**
 * 週報列表 + 內容。
 *
 * 顯示的是「當初存下來的 Markdown」而不是現在重算一次 —— 週報是那一週的
 * 快照,事後重算會得到今天的數字,那就不是週報了。要最新的就按重新產生。
 */
export function WeeklyReportView({ reports }: { reports: WeeklyReportRow[] }) {
  const { notify } = useDialogs();
  const router = useRouter();
  const [selected, setSelected] = useState(reports[0]?.weekStart ?? null);
  const [busy, setBusy] = useState(false);

  const current = reports.find((r) => r.weekStart === selected) ?? null;

  async function generate(week: "last" | "this") {
    setBusy(true);
    try {
      const response = await fetch(`/api/reports/weekly?week=${week}&deliver=1`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        await notify(body.error ?? "產生週報失敗", { title: "無法產生" });
        return;
      }
      // 寄信與寫檔各自回報結果 —— 只說「已產生」會讓人以為信也寄出去了。
      const mail = body.delivery?.mail?.ok
        ? `已寄到 ${body.delivery.mail.to}`
        : `沒有寄出(${body.delivery?.mail?.reason ?? "未知原因"})`;
      const file = body.delivery?.file?.ok
        ? "已存檔"
        : `沒有存檔(${body.delivery?.file?.reason ?? "未知原因"})`;
      await notify(`${body.weekStart} ~ ${body.weekEnd} 的週報已產生。${mail};${file}。`, {
        title: "週報已產生",
      });
      setSelected(body.weekStart);
      router.refresh();
    } catch {
      await notify("產生週報失敗,請稍後再試", { title: "無法產生" });
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!current) return;
    const blob = new Blob([current.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `週報_${current.weekStart}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const button =
    "inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => generate("last")} className={button}>
          <RefreshCw size={12} />
          產生上一週
        </button>
        <button type="button" disabled={busy} onClick={() => generate("this")} className={button}>
          <RefreshCw size={12} />
          產生這一週(到目前為止)
        </button>
        {current && (
          <button type="button" onClick={download} className={button}>
            <Download size={12} />
            下載 Markdown
          </button>
        )}
      </div>

      {reports.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          還沒有任何一份週報。按上面的按鈕產一份,或等排程每週自動產。
        </p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <ul className="shrink-0 space-y-1 lg:w-56">
            {reports.map((r) => (
              <li key={r.weekStart}>
                <button
                  type="button"
                  onClick={() => setSelected(r.weekStart)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    r.weekStart === selected
                      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  }`}
                >
                  {isoWeekLabel(r.weekStart)}
                  <span className="block text-[11px] text-neutral-400 dark:text-neutral-500">
                    {r.weekStart} ~ {r.weekEnd}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {current && (
            <div className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <p className="mb-3 text-[11px] text-neutral-400 dark:text-neutral-500">
                產出時間 {current.createdAt}
              </p>
              {/* 原樣顯示當初存下來的 Markdown —— 不另外渲染成 HTML,因為這份
                  文字就是寄出去的那一份,看到的要跟收到的一樣。 */}
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-neutral-800 dark:text-neutral-100">
                {current.markdown}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
