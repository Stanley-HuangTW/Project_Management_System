import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * 健康檢查:行程活著、而且連得到資料庫就回 200,資料庫連不上或超過 3 秒沒回就回 503。
 * 不用登入(給 docker 的 healthcheck 與監控打的),所以不回任何資料,只有 ok / 不 ok。
 * 查詢本身只有 SELECT 1,不碰任何資料表。
 */
export async function GET() {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), 3000)),
    ]);
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
