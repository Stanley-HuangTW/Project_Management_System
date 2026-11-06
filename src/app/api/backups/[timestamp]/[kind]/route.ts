import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";
import { listBackups } from "@/lib/dbBackup";

/**
 * 下載伺服器上的一份備份檔(系統設定 → 資料庫備份 → 現有備份):kind = db 是資料庫的 .sql.gz,uploads 是附件的 .tgz。
 * 只有管理者能下載(備份有整個資料庫與所有附件)。檔案一律從 listBackups() 列出來的清單裡找,
 * 網址上的時間戳記只是拿來挑,不會被當成路徑用——塞 ../ 之類的字只會找不到。
 * 備份可能很大,邊讀邊傳,不整個讀進記憶體。
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ timestamp: string; kind: string }> }) {
  const session = await requireSession();
  try {
    requireBoardAdmin(session.role);
  } catch {
    return NextResponse.json({ error: "權限不足:僅管理者可以下載備份" }, { status: 403 });
  }

  const { timestamp, kind } = await params;
  if (kind !== "db" && kind !== "uploads") return NextResponse.json({ error: "找不到檔案" }, { status: 404 });

  const backup = (await listBackups()).find((b) => b.timestamp === timestamp);
  if (!backup) return NextResponse.json({ error: "找不到這份備份" }, { status: 404 });
  const file = kind === "db" ? backup.dbFile : backup.uploadsFile;
  if (!file) return NextResponse.json({ error: "這份備份沒有附件檔" }, { status: 404 });

  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return NextResponse.json({ error: "備份檔已經不存在了(可能剛好被清掉)" }, { status: 404 });
  }

  const name = path.basename(file);
  await logAudit("SETTINGS", session.userId, `下載備份檔「${name}」`);
  return new NextResponse(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`,
      "Content-Length": String(size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
