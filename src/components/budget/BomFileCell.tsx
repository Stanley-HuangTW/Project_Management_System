"use client";

import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { formatFileSize } from "@/lib/bomFiles";

export type BomFileRef = { id: string; fileName: string; size: number };

/**
 * BOM 「檔案附件」欄位的一格:列出這一格的檔案(點檔名開啟或下載)、可以上傳(一次選多個)與刪除。
 * 檔案是另外上傳的,不跟整列的「離開這一列才送出」綁在一起——選好檔案就傳,傳完這一格馬上多一個。
 * 這一列還沒存過(空白列)沒有地方掛檔案,先提醒。
 */
export function BomFileCell({
  columnId,
  columnName,
  files,
  canEdit,
  saved,
  flagged,
  onUpload,
  onDelete,
}: {
  columnId: string;
  columnName: string;
  files: BomFileRef[];
  canEdit: boolean;
  /** 這一列已經存在(有 id):空白列沒辦法掛檔案。 */
  saved: boolean;
  /** 必填卻沒有檔案:標成黃色。 */
  flagged: boolean;
  onUpload: (file: File) => Promise<boolean>;
  onDelete: (file: BomFileRef) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        if (!(await onUpload(file))) break; // 失敗的原因已經顯示給使用者了,後面的不用再傳
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-bom-file-cell={columnId}
      className={`flex flex-wrap items-center gap-1 rounded px-1 py-0.5${flagged ? " ring-1 ring-amber-400 bg-amber-50 dark:bg-amber-950/30" : ""}`}
    >
      {files.map((f) => (
        <span
          key={f.id}
          data-bom-file={f.id}
          className="flex max-w-[11rem] items-center gap-0.5 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          <a href={`/api/bom-attachments/${f.id}`} target="_blank" rel="noopener noreferrer" title={`${f.fileName}(${formatFileSize(f.size)})`} className="min-w-0 truncate hover:text-blue-700 hover:underline dark:hover:text-blue-300">
            {f.fileName}
          </a>
          {canEdit && (
            <button type="button" onClick={() => void onDelete(f)} disabled={busy} aria-label={`刪除檔案 ${f.fileName}`} data-bom-file-delete className="shrink-0 text-neutral-400 hover:text-red-600 disabled:opacity-40">
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {canEdit &&
        (saved ? (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              title={`上傳檔案到「${columnName}」(可以一次選好幾個)`}
              aria-label={`上傳檔案到${columnName}`}
              data-bom-file-add
              className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <Paperclip size={12} /> {busy ? "上傳中..." : files.length === 0 ? "上傳" : ""}
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              data-bom-file-input
              onChange={(e) => {
                const list = e.target.files;
                void pick(list).finally(() => {
                  e.target.value = "";
                });
              }}
            />
          </>
        ) : (
          <span className="text-xs text-neutral-400 dark:text-neutral-500">先存這一列</span>
        ))}
      {!canEdit && files.length === 0 && <span className="text-xs text-neutral-300 dark:text-neutral-600">—</span>}
    </div>
  );
}
