"use client";

import { useEffect, useRef, useState } from "react";
import { File as FileIcon, Paperclip, Trash2 } from "lucide-react";
import { deleteAttachment, listAttachments, uploadAttachment } from "@/lib/actions/attachment";
import { actionErrorMessage } from "@/lib/userError";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesTab({ boardId, itemId }: { boardId: string; itemId: string }) {
  const [attachments, setAttachments] = useState<Awaited<ReturnType<typeof listAttachments>>>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setAttachments(await listAttachments(itemId));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await listAttachments(itemId);
        if (!cancelled) setAttachments(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await uploadAttachment(boardId, itemId, formData);
      await refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "上傳失敗"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(attachmentId: string) {
    await deleteAttachment(boardId, itemId, attachmentId);
    await refresh();
  }

  return (
    <div>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
      {error && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-neutral-300 dark:border-neutral-600 py-6 text-sm text-neutral-500 dark:text-neutral-400 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
      >
        <Paperclip size={16} /> {uploading ? "上傳中..." : "點擊新增檔案"}
      </button>

      {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>}
      {!loading && attachments.length === 0 && (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">尚無檔案</p>
      )}
      <ul className="space-y-2">
        {attachments.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 px-3 py-2"
          >
            <FileIcon size={16} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
            <a
              href={`/api/attachments/${a.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-sm text-blue-600 hover:underline"
            >
              {a.fileName}
            </a>
            <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{formatSize(a.size)}</span>
            <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{a.uploader.name}</span>
            <button
              type="button"
              onClick={() => handleDelete(a.id)}
              className="shrink-0 text-neutral-400 dark:text-neutral-500 hover:text-red-600"
              aria-label="刪除"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
