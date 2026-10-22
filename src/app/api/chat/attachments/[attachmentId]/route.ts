import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getSession } from "@/lib/session";
import { findAccessibleAttachment } from "@/lib/chatServer";
import { isInlineImageName } from "@/lib/chat";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export const dynamic = "force-dynamic";

/**
 * 對話裡的檔案與圖片。檔案在 public/uploads/chat/ 底下,但執行期才寫進去的檔案 Next 不會對外服務,
 * 也不該對外服務——一律從這裡走,先確認看得到那間對話(私訊只有兩個人、看板頻道看看板權限)。
 * 只有圖片檔當圖片直接顯示;其他一律強制下載,並禁止瀏覽器猜型別(HTML / SVG 直接開會在本站的網域執行)。
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登入" }, { status: 401 });
  if (session.impersonatorId) return NextResponse.json({ error: "代操作時不能使用對話功能" }, { status: 403 });

  const { attachmentId } = await params;
  const attachment = await findAccessibleAttachment({ userId: session.userId, role: session.role }, attachmentId);
  if (!attachment) return NextResponse.json({ error: "找不到檔案" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(process.cwd(), "public", attachment.url));
  } catch {
    return NextResponse.json({ error: "檔案不存在" }, { status: 404 });
  }

  const inline = isInlineImageName(attachment.fileName);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": inline ? (IMAGE_TYPES[path.extname(attachment.fileName).toLowerCase()] ?? "application/octet-stream") : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
    },
  });
}
