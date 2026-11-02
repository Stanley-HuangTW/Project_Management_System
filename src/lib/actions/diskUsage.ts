"use server";

import { requireSession } from "@/lib/session";
import { UserError } from "@/lib/userError";
import { readDiskReport, type DiskReport } from "@/lib/diskUsageServer";

/** 伺服器磁碟空間與幾個會長大的資料夾的大小。只有管理者看得到(路徑與容量是伺服器內部資訊)。 */
export async function getDiskReport(): Promise<DiskReport> {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new UserError("權限不足:僅管理者可以查看伺服器磁碟空間");
  return readDiskReport();
}
