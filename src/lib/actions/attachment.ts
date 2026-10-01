"use server";

import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { logActivity } from "@/lib/activityLog";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

export async function listAttachments(itemId: string) {
  const session = await requireSession();
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  if (item) await requireBoardAccess(item.boardId, session);
  return prisma.attachment.findMany({
    // 帳的憑證(報價單、發票)不列在這裡:它們屬於那一筆支出/訂單,在預算
    // 頁面顯示,混進工作項的附件清單只會讓人以為是規格文件。
    where: { itemId, expenseId: null, commitmentId: null },
    orderBy: { createdAt: "desc" },
    include: { uploader: { select: { id: true, name: true, avatarUrl: true } } },
  });
}

export async function uploadAttachment(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  formData: FormData
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) {
    throw new Error("請選擇檔案");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("檔案過大,請使用小於 100MB 的檔案");
  }

  const safeName = file.name.replace(/[/\\]/g, "_");
  const storedName = `${Date.now()}-${safeName}`;
  const dir = path.join(process.cwd(), "public", "uploads", itemId);
  await mkdir(dir, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, storedName), bytes);

  const attachment = await prisma.attachment.create({
    data: {
      itemId,
      fileName: file.name,
      url: `/uploads/${itemId}/${storedName}`,
      size: file.size,
      uploaderId: session.userId,
    },
  });

  await logActivity(itemId, session.userId, `上傳檔案「${file.name}」`);
  revalidatePath(`/boards/${boardId}`);
  return attachment;
}

export async function deleteAttachment(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  attachmentId: string
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.itemId !== itemId) return;

  await prisma.attachment.delete({ where: { id: attachmentId } });
  try {
    await unlink(path.join(process.cwd(), "public", attachment.url));
  } catch {
    // file already missing on disk; DB row removal is what matters
  }

  await logActivity(itemId, session.userId, `刪除檔案「${attachment.fileName}」`);
  revalidatePath(`/boards/${boardId}`);
}
