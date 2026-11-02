/**
 * 伺服器磁碟空間的判斷與顯示。純函式,不碰檔案系統(讀取在 diskUsageServer.ts)。
 *
 * 為什麼要有:備份(backups)、週報(weekly-reports)掛在專案資料夾底下,會一直長,沒人看就會把主磁碟塞滿——
 * 2026-11-02 就是這樣,磁碟 100% 之後連 CI 部署都寫不進去。系統設定與管理者的儀表板要早一點講。
 */

export const GIB = 1024 ** 3;

export type DiskLevel = "ok" | "warn" | "critical";

/**
 * 剩餘空間:低於 10 GB 或 15% 是「快滿了」,低於 2 GB 或 5% 是「危險」。
 * 兩個條件取先到的——小磁碟看比例,大磁碟看絕對值。
 */
export function assessDisk(totalBytes: number, freeBytes: number): DiskLevel {
  if (!(totalBytes > 0)) return "ok";
  const ratio = freeBytes / totalBytes;
  if (freeBytes < 2 * GIB || ratio < 0.05) return "critical";
  if (freeBytes < 10 * GIB || ratio < 0.15) return "warn";
  return "ok";
}

const WORST: Record<DiskLevel, number> = { ok: 0, warn: 1, critical: 2 };

export function worstLevel(levels: DiskLevel[]): DiskLevel {
  return levels.reduce<DiskLevel>((worst, l) => (WORST[l] > WORST[worst] ? l : worst), "ok");
}

export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export const DISK_LEVEL_LABELS: Record<DiskLevel, string> = {
  ok: "正常",
  warn: "快滿了",
  critical: "危險",
};

/** 快滿了、危險時,告訴管理者先清哪裡——不是叫他去刪備份,而是先看哪個資料夾最大。 */
export function diskAdvice(level: DiskLevel): string | null {
  if (level === "ok") return null;
  return level === "critical"
    ? "剩餘空間幾乎用完:資料庫備份、上傳與部署都可能寫不進去。請先看下面哪個資料夾最大,把舊的備份複製到別處後清掉,並把備份保留天數調短。"
    : "剩餘空間偏少。請看下面哪個資料夾最大;備份通常是最大宗,可以把保留天數調短(系統設定的「資料庫備份」)。";
}
