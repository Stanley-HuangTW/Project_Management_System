"use client";

import { useCallback, useEffect, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { getDiskReport } from "@/lib/actions/diskUsage";
import { DISK_LEVEL_LABELS, diskAdvice, formatBytes, type DiskLevel } from "@/lib/diskUsage";
import type { DiskReport } from "@/lib/diskUsageServer";
import { knownErrorMessage } from "@/lib/userError";

const LEVEL_BAR: Record<DiskLevel, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  critical: "bg-red-500",
};
const LEVEL_TEXT: Record<DiskLevel, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  critical: "text-red-700 dark:text-red-400",
};

/**
 * 伺服器磁碟空間:備份、週報、上傳的附件各佔多少,以及它們所在的磁碟還剩多少。
 * 備份與週報會一直長,沒人看就會把主磁碟塞滿(2026-11-02 就發生過:磁碟 100% 之後連部署都寫不進去)。
 * 快滿了的時候,管理者的儀表板最上面也會有一張警示。
 */
export function DiskUsageCard() {
  const [report, setReport] = useState<DiskReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await getDiskReport());
      setError(null);
    } catch (err) {
      setError(knownErrorMessage(err, "讀取磁碟空間失敗"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 開設定頁時讀一次;之後按「重新檢查」。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const advice = report ? diskAdvice(report.level) : null;

  return (
    <div className="max-w-2xl rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900" data-disk-usage-card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
          <HardDrive size={15} /> 伺服器磁碟空間
          {report && (
            <span className={`text-xs font-normal ${LEVEL_TEXT[report.level]}`}>({DISK_LEVEL_LABELS[report.level]})</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> 重新檢查
        </button>
      </div>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        剩餘空間低於 10 GB 或 15% 會標「快滿了」,低於 2 GB 或 5% 標「危險」,管理者的儀表板最上面也會出現警示。
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!report && !error && <p className="text-sm text-neutral-400 dark:text-neutral-500">讀取中...</p>}
      {report && report.folders.length === 0 && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">讀不到這台伺服器的資料夾(本機開發環境可能沒有)。</p>
      )}
      {report && report.folders.length > 0 && (
        <ul className="space-y-3">
          {report.folders.map((f) => {
            const used = f.totalBytes > 0 ? Math.min(100, Math.round(((f.totalBytes - f.freeBytes) / f.totalBytes) * 100)) : 0;
            return (
              <li key={f.key} data-disk-folder={f.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="text-neutral-800 dark:text-neutral-100">{f.label}</span>
                  <span className="tabular-nums text-neutral-600 dark:text-neutral-300">
                    {formatBytes(f.sizeBytes)}
                    <span className="ml-1 text-xs text-neutral-400 dark:text-neutral-500">({f.fileCount} 個檔案)</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div className={`h-full ${LEVEL_BAR[f.level]}`} style={{ width: `${used}%` }} />
                </div>
                <p className={`mt-0.5 text-xs ${LEVEL_TEXT[f.level]}`}>
                  所在磁碟共 {formatBytes(f.totalBytes)},已用 {used}%,剩 {formatBytes(f.freeBytes)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {advice && <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{advice}</p>}
    </div>
  );
}
