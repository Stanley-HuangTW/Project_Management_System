import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { requireSession } from "@/lib/session";
import { manualImageNames, visibleChapters } from "@/lib/manual";
import { MANUAL_IMAGES_DIR, loadManual } from "@/lib/manualServer";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * 使用手冊裡的圖片。只送「這個人看得到的章節」引用的圖:管理者章節的畫面,一般成員連直接打網址也拿不到。
 * (docs/ 不在 public/ 底下,所以一定要經過這裡。)
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const session = await requireSession();
  const { name } = await params;

  const loaded = await loadManual();
  if (!loaded) return NextResponse.json({ error: "找不到使用手冊" }, { status: 404 });

  const allowed = new Set(visibleChapters(loaded.manual, session.role === "ADMIN").flatMap((c) => manualImageNames(c.markdown)));
  const type = MIME_TYPES[path.extname(name).toLowerCase()];
  if (!allowed.has(name) || !type) return NextResponse.json({ error: "找不到圖片" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(MANUAL_IMAGES_DIR, path.basename(name)));
  } catch {
    return NextResponse.json({ error: "找不到圖片" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" },
  });
}
