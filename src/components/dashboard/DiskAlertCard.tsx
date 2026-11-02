import Link from "next/link";
import { HardDrive } from "lucide-react";
import { DISK_LEVEL_LABELS, diskAdvice, formatBytes, type DiskLevel } from "@/lib/diskUsage";

/**
 * 管理者的儀表板最上面:伺服器磁碟快滿了。放在可排序的區塊外面——這種警示不該被排到最下面,
 * 沒事的時候整張不出現(一張永遠寫「正常」的卡片沒人會看)。
 */
export function DiskAlertCard({ level, totalBytes, freeBytes }: { level: DiskLevel; totalBytes: number; freeBytes: number }) {
  if (level === "ok") return null;
  const critical = level === "critical";
  return (
    <section
      data-disk-alert={level}
      className={`rounded-lg border p-4 ${
        critical
          ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
          : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
      }`}
    >
      <h2 className={`flex items-center gap-1.5 text-sm font-semibold ${critical ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"}`}>
        <HardDrive size={14} /> 伺服器磁碟空間{DISK_LEVEL_LABELS[level]}:共 {formatBytes(totalBytes)},剩 {formatBytes(freeBytes)}
      </h2>
      <p className={`mt-1 text-xs ${critical ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>{diskAdvice(level)}</p>
      <Link href="/settings" className="mt-2 inline-block text-xs font-medium text-blue-700 hover:underline dark:text-blue-300">
        到系統設定看哪個資料夾最大 →
      </Link>
    </section>
  );
}
