import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getIssueActor } from "@/lib/issueServer";
import { readIssueFile } from "@/lib/issueFilesServer";
import { downloadHeaders } from "@/lib/bomFiles";

/**
 * 下載 ISSUE TRACKER 案件的附件。檔案寫在 public/uploads/issues/ 底下,但不開放直接取用:
 * 這裡先查 ISSUE TRACKER 使用權限。PDF、圖片、純文字直接在瀏覽器開,其他一律下載(見 downloadHeaders)。
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const actor = await getIssueActor();
  if (!actor) return NextResponse.json({ error: "權限不足" }, { status: 403 });
  const { attachmentId } = await params;

  const attachment = await prisma.issueAttachment.findUnique({
    where: { id: attachmentId },
    select: { fileName: true, url: true, isLink: true, case: { select: { deletedAt: true } } },
  });
  if (!attachment || attachment.isLink || attachment.case.deletedAt) return NextResponse.json({ error: "找不到檔案" }, { status: 404 });

  const bytes = await readIssueFile(attachment.url);
  if (!bytes) return NextResponse.json({ error: "檔案不存在" }, { status: 404 });

  const { contentType, disposition } = downloadHeaders(attachment.fileName);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
