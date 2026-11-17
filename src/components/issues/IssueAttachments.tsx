"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Link2, Paperclip, Trash2 } from "lucide-react";
import { addIssueLink, deleteIssueAttachment, uploadIssueFile } from "@/lib/actions/issueAttachments";
import { formatFileSize } from "@/lib/bomFiles";
import type { IssueAttachmentDto } from "@/lib/issueTypes";
import { actionErrorMessage } from "@/lib/userError";
import { useDialogs } from "@/components/ui/DialogProvider";
import { buttonClass, formatDateTime, inputClass } from "./issueUi";

/** 附件:可以上傳檔案(照片、影片、PDF…),也可以貼外部連結(Google Drive 影片之類)。 */
export function IssueAttachments({ caseId, attachments, canAdd, canDelete }: { caseId: string; attachments: IssueAttachmentDto[]; canAdd: boolean; canDelete: (a: IssueAttachmentDto) => boolean }) {
  const router = useRouter();
  const { confirm } = useDialogs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const out = await uploadIssueFile(caseId, form);
      if (out.error) setError(out.error);
      else router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "上傳失敗"));
    } finally {
      setBusy(false);
    }
  }

  async function addLink() {
    setBusy(true);
    setError(null);
    try {
      const out = await addIssueLink(caseId, url, title);
      if (out.error) setError(out.error);
      else {
        setUrl("");
        setTitle("");
        router.refresh();
      }
    } catch (err) {
      setError(actionErrorMessage(err, "新增連結失敗"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: IssueAttachmentDto) {
    if (!(await confirm(`確定要刪除「${a.fileName}」嗎?`, { title: "刪除附件", confirmLabel: "刪除", danger: true }))) return;
    try {
      const out = await deleteIssueAttachment(a.id);
      if (out.error) setError(out.error);
      else router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "刪除失敗"));
    }
  }

  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900" data-testid="issue-attachments" data-issue-attachments>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        <Paperclip size={14} /> 附件與連結
      </h2>
      <ul className="mb-3 space-y-1.5">
        {attachments.map((a) => (
          <li key={a.id} className="group flex items-center gap-2 text-sm" data-testid="attachment-item">
            {a.isLink ? <Link2 size={14} className="shrink-0 text-neutral-400" /> : <FileText size={14} className="shrink-0 text-neutral-400" />}
            <a href={a.url} target={a.isLink ? "_blank" : undefined} rel="noopener noreferrer" className="min-w-0 truncate text-blue-700 hover:underline dark:text-blue-400">
              {a.fileName}
            </a>
            <span className="shrink-0 text-xs text-neutral-400">
              {a.isLink ? "連結" : formatFileSize(a.size)} · {a.uploaderName ?? "匯入"} · {formatDateTime(a.createdAt)}
            </span>
            {canDelete(a) && (
              <button type="button" onClick={() => void remove(a)} title="刪除" className="ml-auto text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
                <Trash2 size={13} />
              </button>
            )}
          </li>
        ))}
        {attachments.length === 0 && <li className="text-sm text-neutral-400">還沒有附件。</li>}
      </ul>
      {canAdd && (
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            data-testid="attachment-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={buttonClass}>
            <Paperclip size={13} /> {busy ? "處理中..." : "上傳檔案"}
          </button>
          <div className="flex flex-wrap gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="貼上連結(https://…)" className={`${inputClass} flex-1`} data-testid="link-url" />
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="顯示名稱(選填)" className={`${inputClass} w-40`} />
            <button type="button" onClick={addLink} disabled={busy || !url.trim()} className={buttonClass} data-testid="link-add">
              <Link2 size={13} /> 加連結
            </button>
          </div>
        </div>
      )}
      {error && <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
    </section>
  );
}
