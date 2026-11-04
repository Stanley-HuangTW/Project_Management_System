import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { hideBudgetOn } from "@/lib/budgetAccessServer";
import { readBomFile } from "@/lib/bomFilesServer";
import { downloadHeaders } from "@/lib/bomFiles";

/**
 * 下載 BOM 的檔案附件。檔案寫在 public/uploads/bom/ 底下,但不開放直接取用:這裡先查看板存取,
 * 再查預算可見範圍——BOM 有單價與報價,看不到預算金額的人也不能下載它的附件(跟 BOM 表格本身同一條規則)。
 * PDF、圖片、純文字直接在瀏覽器開,其他一律下載(見 downloadHeaders)。
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const session = await requireSession();
  const { attachmentId } = await params;

  const attachment = await prisma.bomAttachment.findUnique({
    where: { id: attachmentId },
    select: { boardId: true, fileName: true, url: true },
  });
  if (!attachment) return NextResponse.json({ error: "找不到檔案" }, { status: 404 });

  try {
    await requireBoardAccess(attachment.boardId, session);
  } catch {
    return NextResponse.json({ error: "權限不足" }, { status: 403 });
  }
  if (await hideBudgetOn(attachment.boardId, session)) return NextResponse.json({ error: "你的角色看不到預算金額" }, { status: 403 });

  const bytes = await readBomFile(attachment.url);
  if (!bytes) return NextResponse.json({ error: "檔案不存在" }, { status: 404 });

  const { contentType, disposition } = downloadHeaders(attachment.fileName);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      // 瀏覽器不要自己猜檔案種類:上傳的東西不能被當成網頁執行。
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
