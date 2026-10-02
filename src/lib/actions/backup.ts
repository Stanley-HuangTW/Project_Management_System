"use server";

import { revalidatePath } from "next/cache";
import path from "path";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { cleanupOldBackups, listBackups, restoreFromFiles, runBackup, type BackupFile } from "@/lib/dbBackup";

// "use server" 檔案只能匯出 async function,這個小標籤表不能從
// systemSettings.ts 匯出共用,直接在這裡放一份一樣的。
const DOW_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

export type BackupScheduleInput = {
  enabled: boolean;
  frequency: "DAILY" | "WEEKLY";
  dow: number;
  hour: number;
  minute: number;
  retentionDays: number;
};

export async function setBackupSchedule(schedule: BackupScheduleInput): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  if (schedule.dow < 0 || schedule.dow > 6) return { error: "星期幾不合法" };
  if (schedule.hour < 0 || schedule.hour > 23) return { error: "小時不合法" };
  if (schedule.minute < 0 || schedule.minute > 59) return { error: "分鐘不合法" };
  if (schedule.retentionDays < 1 || schedule.retentionDays > 3650) return { error: "保留天數不合法" };

  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      backupEnabled: schedule.enabled,
      backupFrequency: schedule.frequency,
      backupDow: schedule.dow,
      backupHour: schedule.hour,
      backupMinute: schedule.minute,
      backupRetentionDays: schedule.retentionDays,
    },
    update: {
      backupEnabled: schedule.enabled,
      backupFrequency: schedule.frequency,
      backupDow: schedule.dow,
      backupHour: schedule.hour,
      backupMinute: schedule.minute,
      backupRetentionDays: schedule.retentionDays,
    },
  });

  const when =
    schedule.frequency === "WEEKLY"
      ? `每${DOW_LABELS[schedule.dow]} ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`
      : `每天 ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  await logAudit("SETTINGS", session.userId, schedule.enabled ? `資料庫備份排程設定為${when}` : "資料庫備份排程關閉");
  revalidatePath("/settings");
  return {};
}

export async function listBackupFiles(): Promise<BackupFile[]> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  return listBackups();
}

/** 跟排程心跳的 runBackup() + cleanupOldBackups() 同一套順序,手動按
 *  的這次也照樣清掉過期的舊備份,而不是只有排程觸發才會清。 */
export async function triggerManualBackup(): Promise<{ error?: string; timestamp?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  try {
    const result = await runBackup();
    const settings = await getSystemSettings();
    await cleanupOldBackups(settings.backupRetentionDays);
    await logAudit("SETTINGS", session.userId, `手動觸發資料庫備份(${result.timestamp})`);
    revalidatePath("/settings");
    return { timestamp: result.timestamp };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "備份失敗" };
  }
}

/** 還原伺服器上既有的一份備份——confirmText 必須等於該備份的時間戳記。 */
export async function restoreBackup(
  timestamp: string,
  confirmText: string
): Promise<{ error?: string; preRestoreTimestamp?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  if (confirmText !== timestamp) return { error: "確認文字不符,沒有執行還原" };

  const backups = await listBackups();
  const target = backups.find((b) => b.timestamp === timestamp);
  if (!target) return { error: "找不到這份備份" };

  try {
    const result = await restoreFromFiles(target.dbFile, target.uploadsFile);
    await logAudit("SETTINGS", session.userId, `還原資料庫到備份「${timestamp}」(還原前已另存「${result.preRestoreBackup.timestamp}」)`);
    revalidatePath("/settings");
    return { preRestoreTimestamp: result.preRestoreBackup.timestamp };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "還原失敗" };
  }
}

/**
 * 還原上傳的外部備份檔——沒有既有時間戳記可以要求輸入,改成要求輸入上傳
 * 的資料庫備份檔檔名本身,同一個精神:打出你正要蓋掉資料庫的那個東西。
 */
export async function restoreUploadedBackup(
  formData: FormData,
  confirmText: string
): Promise<{ error?: string; preRestoreTimestamp?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const dbFile = formData.get("dbFile");
  const uploadsFile = formData.get("uploadsFile");
  if (!(dbFile instanceof File) || !dbFile.name) {
    return { error: "請選擇資料庫備份檔(.sql.gz)" };
  }
  if (confirmText !== dbFile.name) return { error: "確認文字不符,沒有執行還原" };

  const tempDir = await mkdtemp(path.join(tmpdir(), "restore-upload-"));
  try {
    const dbPath = path.join(tempDir, dbFile.name);
    await writeFile(dbPath, Buffer.from(await dbFile.arrayBuffer()));

    let uploadsPath: string | null = null;
    if (uploadsFile instanceof File && uploadsFile.name) {
      uploadsPath = path.join(tempDir, uploadsFile.name);
      await writeFile(uploadsPath, Buffer.from(await uploadsFile.arrayBuffer()));
    }

    const result = await restoreFromFiles(dbPath, uploadsPath);
    await logAudit(
      "SETTINGS",
      session.userId,
      `還原資料庫到上傳的備份檔「${dbFile.name}」(還原前已另存「${result.preRestoreBackup.timestamp}」)`
    );
    revalidatePath("/settings");
    return { preRestoreTimestamp: result.preRestoreBackup.timestamp };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "還原失敗" };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
