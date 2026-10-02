"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isoWeekLabel, type WeeklyReportData, type WeeklyReportDiff } from "@/lib/weeklyReport";
import { WeeklyProgramPanel } from "@/components/reports/WeeklyProgramPanel";

export type WeeklyReportRow = {
  weekStart: string;
  weekEnd: string;
  markdown: string;
  createdAt: string;
  /** 結構化內容——分頁籤是靠這個畫的,不是重新解析 markdown。舊版格式/壞資料是 null。 */
  data: WeeklyReportData | null;
  diff: WeeklyReportDiff | null;
};

/**
 * 週報列表 + 內容。
 *
 * 顯示的是「當初存下來的 Markdown」而不是現在重算一次 —— 週報是那一週的
 * 快照,事後重算會得到今天的數字,那就不是週報了。要最新的就按重新產生。
 */
/** 沒有歸屬專案群組的看板那一段,分頁籤的 key 不能是 null。 */
const NO_PROGRAM_TAB = "__none__";

export function WeeklyReportView({ reports }: { reports: WeeklyReportRow[] }) {
  const { notify } = useDialogs();
  const router = useRouter();
  const [selected, setSelected] = useState(reports[0]?.weekStart ?? null);
  const [busy, setBusy] = useState(false);
  const [activeProgramTab, setActiveProgramTab] = useState<string>(NO_PROGRAM_TAB);
  const [fullscreen, setFullscreen] = useState(false);

  // 全螢幕時按 Esc 退出——跟瀏覽器原生全螢幕的習慣一致。
  useEffect(() => {
    if (!fullscreen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const current = reports.find((r) => r.weekStart === selected) ?? null;
  const programs = useMemo(() => current?.data?.programs ?? [], [current]);
  // 切換週次後,原本選的分頁籤這一週不一定還在(專案群組可能才剛成立)——
  // 不在就退回第一個,而不是顯示一個空畫面。
  const activeTabKey = programs.some((p) => (p.programName ?? NO_PROGRAM_TAB) === activeProgramTab)
    ? activeProgramTab
    : (programs[0]?.programName ?? NO_PROGRAM_TAB);
  const activeProgram = programs.find((p) => (p.programName ?? NO_PROGRAM_TAB) === activeTabKey) ?? null;

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
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 overflow-y-auto bg-neutral-50 p-4 dark:bg-neutral-950"
          : "space-y-4"
      }
    >
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
        {reports.length > 0 && (
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="ml-auto rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
          >
            {reports.map((r) => (
              <option key={r.weekStart} value={r.weekStart}>
                {isoWeekLabel(r.weekStart)}({r.weekStart} ~ {r.weekEnd})
              </option>
            ))}
          </select>
        )}
        {current && (
          <button type="button" onClick={() => setFullscreen((v) => !v)} className={button}>
            {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {fullscreen ? "退出全螢幕" : "全螢幕顯示"}
          </button>
        )}
      </div>

      {reports.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          還沒有任何一份週報。按上面的按鈕產一份,或等排程每週自動產。
        </p>
      ) : (
        current && (
          <div className="min-w-0 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <p className="mb-3 text-[11px] text-neutral-400 dark:text-neutral-500">
              產出時間 {current.createdAt}
            </p>
            {current.data && current.diff ? (
              <>
                <div className="mb-4 flex w-fit flex-wrap overflow-hidden rounded-md border border-neutral-200 text-sm dark:border-neutral-700">
                  {programs.map((p) => {
                    const key = p.programName ?? NO_PROGRAM_TAB;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setActiveProgramTab(key)}
                        className={`px-3 py-1.5 ${
                          key === activeTabKey
                            ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                            : "bg-white text-neutral-600 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
                        }`}
                      >
                        {p.programName ?? "未歸屬專案群組"}
                      </button>
                    );
                  })}
                </div>
                {activeProgram && (
                  <WeeklyProgramPanel
                    program={activeProgram}
                    departments={current.data.departments}
                    diff={current.diff}
                    upcomingDays={current.data.upcomingDays}
                  />
                )}
              </>
            ) : (
              // 舊版格式沒有結構化內容可以拆分頁籤,退回原樣顯示當初存下來的 Markdown。
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-neutral-800 dark:text-neutral-100">
                {current.markdown}
              </pre>
            )}
          </div>
        )
      )}
    </div>
  );
}
