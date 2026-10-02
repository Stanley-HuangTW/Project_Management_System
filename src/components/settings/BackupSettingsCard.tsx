"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, DatabaseBackup, RefreshCw, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  listBackupFiles,
  restoreBackup,
  restoreUploadedBackup,
  setBackupSchedule,
  triggerManualBackup,
  type BackupScheduleInput,
} from "@/lib/actions/backup";
import type { BackupFile } from "@/lib/dbBackup";

const DOW_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 還原的二次確認——要求輸入指定的識別字串(備份時間戳記,或上傳檔案的
 *  檔名),完全相符前「確認還原」維持 disabled。還原會覆蓋現有資料庫,
 *  只用一個「確定嗎」對話框不夠慎重。 */
function RestoreConfirmModal({
  open,
  onOpenChange,
  description,
  requiredText,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  requiredText: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  // 重新打開時清空輸入框——「render 當下比對 prop 有沒有變」,不是 effect,
  // 同一個做法見 ItemDetailModal.tsx 重置分頁的地方。
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setTyped("");
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="還原確認">
      <div className="mb-3 flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>{description}這個動作會蓋掉現有資料庫。系統會先自動存一份「還原前」的快照,萬一選錯還救得回來。</span>
      </div>
      <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-300">
        請輸入 <code className="rounded bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5">{requiredText}</code> 以確認:
      </p>
      <input
        autoFocus
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="mb-4 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
      />
      <button
        type="button"
        disabled={typed !== requiredText || busy}
        onClick={onConfirm}
        className="w-full rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
      >
        {busy ? "還原中..." : "確認還原"}
      </button>
    </Modal>
  );
}

export function BackupSettingsCard({ initial }: { initial: BackupScheduleInput }) {
  const { notify } = useDialogs();
  const [schedule, setSchedule] = useState(initial);
  const [isPending, startTransition] = useTransition();

  const [backups, setBackups] = useState<BackupFile[] | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [restoreTarget, setRestoreTarget] = useState<BackupFile | null>(null);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [dbUploadFile, setDbUploadFile] = useState<File | null>(null);
  const [uploadsUploadFile, setUploadsUploadFile] = useState<File | null>(null);

  async function refreshBackups() {
    setBackups(await listBackupFiles());
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listBackupFiles();
      if (!cancelled) setBackups(result);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function save(next: typeof schedule) {
    setSchedule(next);
    startTransition(async () => {
      const result = await setBackupSchedule(next);
      if (result.error) await notify(result.error, { title: "無法儲存" });
    });
  }

  async function handleManualBackup() {
    setBackingUp(true);
    try {
      const result = await triggerManualBackup();
      if (result.error) {
        await notify(result.error, { title: "備份失敗" });
      } else {
        await notify(`已產生備份(${result.timestamp})`, { title: "備份完成" });
        await refreshBackups();
      }
    } finally {
      setBackingUp(false);
    }
  }

  async function handleRestoreExisting(confirmText: string) {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const result = await restoreBackup(restoreTarget.timestamp, confirmText);
      if (result.error) {
        await notify(result.error, { title: "還原失敗" });
      } else {
        await notify(`已還原到「${restoreTarget.timestamp}」(還原前快照:${result.preRestoreTimestamp})`, {
          title: "還原完成",
        });
        setRestoreTarget(null);
        await refreshBackups();
      }
    } finally {
      setRestoring(false);
    }
  }

  async function handleRestoreUpload(confirmText: string) {
    if (!dbUploadFile) return;
    setRestoring(true);
    try {
      const formData = new FormData();
      formData.append("dbFile", dbUploadFile);
      if (uploadsUploadFile) formData.append("uploadsFile", uploadsUploadFile);
      const result = await restoreUploadedBackup(formData, confirmText);
      if (result.error) {
        await notify(result.error, { title: "還原失敗" });
      } else {
        await notify(`已還原上傳的備份檔(還原前快照:${result.preRestoreTimestamp})`, { title: "還原完成" });
        setUploadConfirmOpen(false);
        setDbUploadFile(null);
        setUploadsUploadFile(null);
        await refreshBackups();
      }
    } finally {
      setRestoring(false);
    }
  }

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

  return (
    <div className="max-w-2xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        <DatabaseBackup size={15} /> 資料庫備份
      </p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        備份涵蓋資料庫跟所有上傳的附件。排程跟手動備份都存進伺服器上的同一個
        <code className="mx-1 rounded bg-neutral-100 dark:bg-neutral-800 px-1">backups/</code>
        資料夾。
      </p>

      <label className="mb-3 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
        <input
          type="checkbox"
          disabled={isPending}
          checked={schedule.enabled}
          onChange={(e) => save({ ...schedule, enabled: e.target.checked })}
        />
        啟用排程
      </label>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={schedule.frequency}
          disabled={isPending || !schedule.enabled}
          onChange={(e) => save({ ...schedule, frequency: e.target.value as "DAILY" | "WEEKLY" })}
          className={fieldClass}
        >
          <option value="DAILY">每天</option>
          <option value="WEEKLY">每週</option>
        </select>
        {schedule.frequency === "WEEKLY" && (
          <select
            value={schedule.dow}
            disabled={isPending || !schedule.enabled}
            onChange={(e) => save({ ...schedule, dow: Number(e.target.value) })}
            className={fieldClass}
          >
            {DOW_LABELS.map((label, dow) => (
              <option key={dow} value={dow}>
                {label}
              </option>
            ))}
          </select>
        )}
        <select
          value={schedule.hour}
          disabled={isPending || !schedule.enabled}
          onChange={(e) => save({ ...schedule, hour: Number(e.target.value) })}
          className={fieldClass}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")} 點
            </option>
          ))}
        </select>
        <select
          value={schedule.minute}
          disabled={isPending || !schedule.enabled}
          onChange={(e) => save({ ...schedule, minute: Number(e.target.value) })}
          className={fieldClass}
        >
          {[0, 15, 30, 45].map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")} 分
            </option>
          ))}
        </select>
        <span className="text-sm text-neutral-600 dark:text-neutral-300">保留</span>
        <input
          type="number"
          min={1}
          max={3650}
          value={schedule.retentionDays}
          disabled={isPending}
          onChange={(e) => save({ ...schedule, retentionDays: Number(e.target.value) })}
          className={`${fieldClass} w-20 tabular-nums`}
        />
        <span className="text-sm text-neutral-600 dark:text-neutral-300">天</span>
      </div>

      <button
        type="button"
        disabled={backingUp}
        onClick={handleManualBackup}
        className="mb-4 flex items-center gap-1.5 rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
      >
        <RefreshCw size={13} className={backingUp ? "animate-spin" : ""} /> {backingUp ? "備份中..." : "立即備份"}
      </button>

      <p className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">現有備份</p>
      {backups === null ? (
        <p className="py-3 text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : backups.length === 0 ? (
        <p className="py-3 text-sm text-neutral-400 dark:text-neutral-500">還沒有任何備份。</p>
      ) : (
        <ul className="mb-4 divide-y divide-neutral-100 dark:divide-neutral-700 rounded-md border border-neutral-200 dark:border-neutral-700">
          {backups.map((b) => (
            <li key={b.timestamp} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate tabular-nums text-neutral-700 dark:text-neutral-100">
                {b.timestamp}
              </span>
              <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                DB {formatSize(b.dbSize)}
                {b.uploadsSize !== null && ` · 附件 ${formatSize(b.uploadsSize)}`}
              </span>
              <button
                type="button"
                onClick={() => setRestoreTarget(b)}
                className="shrink-0 rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              >
                還原
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">上傳備份檔還原</p>
      <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
        從別台機器搬過來的備份(例如搬遷到新伺服器),可以直接在這裡上傳還原,不用再手動
        SSH 執行指令。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".sql.gz,.gz"
          onChange={(e) => setDbUploadFile(e.target.files?.[0] ?? null)}
          className="text-xs text-neutral-600 dark:text-neutral-300"
        />
        <input
          type="file"
          accept=".tgz,.tar.gz"
          onChange={(e) => setUploadsUploadFile(e.target.files?.[0] ?? null)}
          className="text-xs text-neutral-600 dark:text-neutral-300"
        />
        <button
          type="button"
          disabled={!dbUploadFile}
          onClick={() => setUploadConfirmOpen(true)}
          className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
        >
          <Upload size={12} /> 上傳並還原
        </button>
      </div>

      <RestoreConfirmModal
        open={restoreTarget !== null}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        description={`即將還原到備份「${restoreTarget?.timestamp}」。`}
        requiredText={restoreTarget?.timestamp ?? ""}
        busy={restoring}
        onConfirm={() => handleRestoreExisting(restoreTarget?.timestamp ?? "")}
      />
      <RestoreConfirmModal
        open={uploadConfirmOpen}
        onOpenChange={setUploadConfirmOpen}
        description={`即將還原上傳的檔案「${dbUploadFile?.name}」。`}
        requiredText={dbUploadFile?.name ?? ""}
        busy={restoring}
        onConfirm={() => handleRestoreUpload(dbUploadFile?.name ?? "")}
      />
    </div>
  );
}
