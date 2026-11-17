import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { safeFileName } from "@/lib/bomFiles";

/**
 * ISSUE TRACKER 案件附件在磁碟上的存取。檔案寫在 public/uploads/issues/<案件>/ 底下(跟其他附件同一個磁碟區:
 * docker 掛載、資料庫備份的 uploads 壓縮檔都已涵蓋),但不能直接從 /uploads/... 取用:要走
 * /api/issue-attachments/<id>,先查 ISSUE TRACKER 權限。不在 "use server" 檔案裡。
 */

const PUBLIC_DIR = () => path.join(process.cwd(), "public");

export function isIssueFileUrl(url: string): boolean {
  return /^\/uploads\/issues\/[A-Za-z0-9_-]+\/[^/\\]+$/.test(url) && !url.includes("..");
}

export async function writeIssueFile(caseId: string, file: File): Promise<{ url: string; fileName: string; size: number }> {
  if (!/^[A-Za-z0-9_-]+$/.test(caseId)) throw new Error("案件代號不正確");
  const fileName = safeFileName(file.name);
  const stored = `${Date.now()}-${randomBytes(4).toString("hex")}-${fileName}`;
  const dir = path.join(PUBLIC_DIR(), "uploads", "issues", caseId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, stored), Buffer.from(await file.arrayBuffer()));
  return { url: `/uploads/issues/${caseId}/${stored}`, fileName, size: file.size };
}

export async function readIssueFile(url: string): Promise<Buffer | null> {
  if (!isIssueFileUrl(url)) return null;
  try {
    return await readFile(path.join(PUBLIC_DIR(), url));
  } catch {
    return null;
  }
}

export async function removeIssueFiles(urls: string[]): Promise<void> {
  for (const url of urls) {
    if (!isIssueFileUrl(url)) continue;
    try {
      await unlink(path.join(PUBLIC_DIR(), url));
    } catch {
      /* 檔案已經不在了,資料庫那邊的列才是重點 */
    }
  }
}
