"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/userError";
import { requireIssueActor } from "@/lib/issueServer";
import { canAddLog, canManageIssues } from "@/lib/issueAccess";
import { removeIssueFiles, writeIssueFile } from "@/lib/issueFilesServer";
import { MAX_ISSUE_FILE_SIZE, MAX_ISSUE_FILES } from "@/lib/issueTypes";

async function loadFacts(caseId: string) {
  const c = await prisma.issueCase.findFirst({
    where: { id: caseId, deletedAt: null },
    select: { reporterId: true, confirmedAt: true, assignees: { select: { userId: true } } },
  });
  if (!c) throw new UserError("找不到這個案件(可能已經被刪除)");
  return { reporterId: c.reporterId, assigneeIds: c.assignees.map((a) => a.userId), locked: c.confirmedAt !== null };
}

/** 上傳檔案到案件。能做的人跟能在時間軸留言的人一樣。formData 的 file 欄是檔案。 */
export async function uploadIssueFile(caseId: string, formData: FormData): Promise<{ error?: string }> {
  const { role, userId } = await requireIssueActor();
  const facts = await loadFacts(caseId);
  if (!canAddLog(role, userId, facts)) return { error: "這個案件已經鎖定,不能再上傳附件" };

  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) return { error: "請選擇檔案" };
  if (file.size === 0) return { error: "這個檔案是空的" };
  if (file.size > MAX_ISSUE_FILE_SIZE) return { error: `檔案太大了(上限 ${MAX_ISSUE_FILE_SIZE / 1024 / 1024} MB)` };
  if ((await prisma.issueAttachment.count({ where: { caseId } })) >= MAX_ISSUE_FILES) return { error: `附件太多了(最多 ${MAX_ISSUE_FILES} 個)` };

  const saved = await writeIssueFile(caseId, file);
  await prisma.issueAttachment.create({ data: { caseId, fileName: saved.fileName, url: saved.url, size: saved.size, uploaderId: userId } });
  revalidatePath("/issues", "layout");
  return {};
}

/** 加一個外部連結(Google Drive 影片、雲端資料夾…),只收 http(s)。 */
export async function addIssueLink(caseId: string, url: string, title: string): Promise<{ error?: string }> {
  const { role, userId } = await requireIssueActor();
  const facts = await loadFacts(caseId);
  if (!canAddLog(role, userId, facts)) return { error: "這個案件已經鎖定,不能再新增連結" };

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { error: "請輸入完整的網址(以 http:// 或 https:// 開頭)" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: "只能新增 http 或 https 的連結" };
  const name = title.trim().slice(0, 200) || parsed.hostname;
  if ((await prisma.issueAttachment.count({ where: { caseId } })) >= MAX_ISSUE_FILES) return { error: `附件太多了(最多 ${MAX_ISSUE_FILES} 個)` };

  await prisma.issueAttachment.create({ data: { caseId, fileName: name, url: parsed.toString(), size: 0, isLink: true, uploaderId: userId } });
  revalidatePath("/issues", "layout");
  return {};
}

export async function deleteIssueAttachment(attachmentId: string): Promise<{ error?: string }> {
  const { role, userId } = await requireIssueActor();
  const a = await prisma.issueAttachment.findUnique({ where: { id: attachmentId }, select: { caseId: true, url: true, isLink: true, uploaderId: true } });
  if (!a) return { error: "找不到這個附件(可能已經被刪除)" };
  const facts = await loadFacts(a.caseId);
  const allowed = canManageIssues(role) || (a.uploaderId === userId && !facts.locked);
  if (!allowed) return { error: "權限不足:只有管理者或上傳的人(案件未鎖定時)可以刪除附件" };

  await prisma.issueAttachment.delete({ where: { id: attachmentId } });
  if (!a.isLink) await removeIssueFiles([a.url]);
  revalidatePath("/issues", "layout");
  return {};
}
