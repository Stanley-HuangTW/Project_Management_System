import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { isBomFileUrl, safeFileName } from "@/lib/bomFiles";

/**
 * BOM 檔案附件在磁碟上的存取。檔案寫在 public/uploads/bom/<看板>/ 底下——跟其他附件同一個磁碟區(docker 掛載、
 * 資料庫備份的 uploads 壓縮檔都已經涵蓋),但不能直接從 /uploads/... 網址取用:要走 /api/bom-attachments/<id>,
 * 先查看板權限與預算可見範圍。不在 "use server" 檔案裡:那裡的匯出都會變成對外的 Server Action。
 */

const PUBLIC_DIR = () => path.join(process.cwd(), "public");

/** 寫一個上傳的檔案,回傳要存進資料庫的資訊(url 是相對於 public/ 的路徑)。 */
export async function writeBomFile(boardId: string, file: File): Promise<{ url: string; fileName: string; size: number }> {
  if (!/^[A-Za-z0-9_-]+$/.test(boardId)) throw new Error("看板代號不正確");
  const fileName = safeFileName(file.name);
  // 時間 + 亂數:同一秒傳兩個同名檔案不會互相蓋掉,也猜不到別人檔案的路徑。
  const stored = `${Date.now()}-${randomBytes(4).toString("hex")}-${fileName}`;
  const dir = path.join(PUBLIC_DIR(), "uploads", "bom", boardId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, stored), Buffer.from(await file.arrayBuffer()));
  return { url: `/uploads/bom/${boardId}/${stored}`, fileName, size: file.size };
}

export async function readBomFile(url: string): Promise<Buffer | null> {
  if (!isBomFileUrl(url)) return null;
  try {
    return await readFile(path.join(PUBLIC_DIR(), url));
  } catch {
    return null;
  }
}

/** 刪磁碟上的檔案(資料庫的列由呼叫端處理)。檔案早就不在了不算錯;路徑不在 BOM 檔案的資料夾底下的不碰。 */
export async function removeBomFiles(urls: string[]): Promise<void> {
  for (const url of urls) {
    if (!isBomFileUrl(url)) continue;
    try {
      await unlink(path.join(PUBLIC_DIR(), url));
    } catch {
      /* 檔案已經不在了,資料庫那邊的列才是重點 */
    }
  }
}
