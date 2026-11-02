import { readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { BACKUP_DIR } from "@/lib/dbBackup";
import { reportDir } from "@/lib/weeklyReportDelivery";
import { assessDisk, worstLevel, type DiskLevel } from "@/lib/diskUsage";

/** 一個會長大的資料夾:自己多大,以及它所在的那顆磁碟還剩多少。 */
export type DiskFolder = {
  key: "backups" | "weeklyReports" | "uploads";
  label: string;
  /** 資料夾自己佔的空間(遞迴加總)。 */
  sizeBytes: number;
  fileCount: number;
  /** 所在磁碟的總量與剩餘。 */
  totalBytes: number;
  freeBytes: number;
  level: DiskLevel;
};

export type DiskReport = { folders: DiskFolder[]; level: DiskLevel };

const MAX_ENTRIES = 200_000;

/** 遞迴加總資料夾大小。檔案太多就停(回報到目前為止的數字),不讓設定頁卡住。 */
async function folderSize(dir: string): Promise<{ sizeBytes: number; fileCount: number }> {
  let sizeBytes = 0;
  let fileCount = 0;
  const pending = [dir];
  while (pending.length > 0 && fileCount < MAX_ENTRIES) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) {
        try {
          sizeBytes += (await stat(full)).size;
          fileCount++;
        } catch {
          // 讀的當下檔案被刪了,略過。
        }
      }
    }
  }
  return { sizeBytes, fileCount };
}

async function diskOf(dir: string): Promise<{ totalBytes: number; freeBytes: number } | null> {
  try {
    const fs = await statfs(dir);
    // bavail:一般使用者實際寫得進去的空間(不含系統保留),比 bfree 貼近「還能寫多少」。
    return { totalBytes: fs.blocks * fs.bsize, freeBytes: fs.bavail * fs.bsize };
  } catch {
    return null;
  }
}

const FOLDERS: { key: DiskFolder["key"]; label: string; dir: () => string }[] = [
  { key: "backups", label: "資料庫與上傳檔備份(backups)", dir: () => BACKUP_DIR },
  { key: "weeklyReports", label: "週報檔案(weekly-reports)", dir: () => reportDir() },
  { key: "uploads", label: "上傳的附件與對話檔案(uploads)", dir: () => path.join(process.cwd(), "public", "uploads") },
];

/** 設定頁用:每個資料夾的大小與所在磁碟的剩餘空間。資料夾不存在(本機開發)就不列。 */
export async function readDiskReport(): Promise<DiskReport> {
  const folders: DiskFolder[] = [];
  for (const f of FOLDERS) {
    const dir = f.dir();
    const disk = await diskOf(dir);
    if (!disk) continue;
    const size = await folderSize(dir);
    folders.push({ key: f.key, label: f.label, ...size, ...disk, level: assessDisk(disk.totalBytes, disk.freeBytes) });
  }
  return { folders, level: worstLevel(folders.map((f) => f.level)) };
}

/** 儀表板警示用:只問剩餘空間,不掃資料夾(每次開儀表板都會呼叫,要便宜)。 */
export async function readDiskLevel(): Promise<{ level: DiskLevel; totalBytes: number; freeBytes: number } | null> {
  // 備份與週報掛在主磁碟上(bind mount),附件是 Docker volume 在另一顆;兩顆都看,取最差的那顆。
  const disks = (
    await Promise.all([BACKUP_DIR, path.join(process.cwd(), "public", "uploads")].map((dir) => diskOf(dir)))
  ).filter((d): d is { totalBytes: number; freeBytes: number } => d !== null);
  if (disks.length === 0) return null;
  const worst = disks.reduce((a, b) => (a.freeBytes / a.totalBytes <= b.freeBytes / b.totalBytes ? a : b));
  return { level: worstLevel(disks.map((d) => assessDisk(d.totalBytes, d.freeBytes))), ...worst };
}
