"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { canEditBoardBudget } from "@/lib/boardBudgetRights";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";
import { loadBomColumns } from "@/lib/bomColumnsServer";
import { removeBomFiles, writeBomFile } from "@/lib/bomFilesServer";
import { MAX_BOM_FILE_SIZE, MAX_FILES_PER_CELL } from "@/lib/bomFiles";

/**
 * 樣機 BOM「檔案附件」欄位:上傳與刪除。能做的人跟編輯 BOM 的人一樣(管理者、專案建立者、分組的 Team Leader)。
 * 下載走 /api/bom-attachments/<id>(先查看板權限與預算可見範圍)。
 */

async function requireBomEditor(boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (!(await canEditBoardBudget(boardId, session))) {
    throw new UserError("權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯樣機 BOM");
  }
  return session;
}

/** 傳到這一列的這個檔案附件欄位。formData 的 file 欄是檔案。 */
export async function uploadBomFile(boardId: string, lineId: string, columnId: string, formData: FormData): Promise<{ error?: string }> {
  const session = await requireBomEditor(boardId);

  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) return { error: "請選擇檔案" };
  if (file.size === 0) return { error: "這個檔案是空的" };
  if (file.size > MAX_BOM_FILE_SIZE) return { error: `檔案太大了(上限 ${MAX_BOM_FILE_SIZE / 1024 / 1024} MB)` };

  const line = await prisma.bomLine.findUnique({ where: { id: lineId }, select: { boardId: true, name: true } });
  if (!line || line.boardId !== boardId) return { error: "找不到這一列" };
  // 欄位要是這個看板現在設定的「檔案附件」欄位:代號是畫面傳來的,不信任。
  const column = (await loadBomColumns(boardId)).find((c) => c.id === columnId && c.type === "FILE");
  if (!column) return { error: "找不到這個檔案附件欄位" };
  const existing = await prisma.bomAttachment.count({ where: { bomLineId: lineId, columnId } });
  if (existing >= MAX_FILES_PER_CELL) return { error: `這一格的檔案太多了(最多 ${MAX_FILES_PER_CELL} 個)` };

  const saved = await writeBomFile(boardId, file);
  await prisma.bomAttachment.create({
    data: { boardId, bomLineId: lineId, columnId, fileName: saved.fileName, url: saved.url, size: saved.size, uploaderId: session.userId },
  });
  await logAudit("COST", session.userId, `上傳 BOM 檔案「${saved.fileName}」(${line.name} / ${column.name})`, boardId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function deleteBomFile(boardId: string, attachmentId: string): Promise<{ error?: string }> {
  const session = await requireBomEditor(boardId);
  const attachment = await prisma.bomAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.boardId !== boardId) return { error: "找不到這個檔案(可能已經被刪除)" };

  await prisma.bomAttachment.delete({ where: { id: attachmentId } });
  await removeBomFiles([attachment.url]);
  await logAudit("COST", session.userId, `刪除 BOM 檔案「${attachment.fileName}」`, boardId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}
