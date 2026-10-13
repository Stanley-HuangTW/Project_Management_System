"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { DASHBOARD_BOARD_COOKIE, encodeBoardCookie } from "@/lib/dashboardBoardFilter";

const MAX_BOARDS = 200;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * 記住儀表板「看板篩選」選的看板(可以多個)。沒選任何一個 = 全部看板,把記的清掉。
 * 只記這個人看得到的看板——傳進來的 id 先對權限過濾,不信任前端送來的清單。
 */
export async function saveDashboardBoardFilter(boardIds: string[]): Promise<{ error?: string }> {
  const session = await requireSession();
  if (!Array.isArray(boardIds) || boardIds.length > MAX_BOARDS) return { error: "選的看板太多" };

  const accessible = boardIds.length
    ? await prisma.board.findMany({
        where: { ...accessibleBoardWhere(session), id: { in: boardIds.filter((id) => typeof id === "string") } },
        select: { id: true },
      })
    : [];
  const ids = accessible.map((b) => b.id);

  const store = await cookies();
  if (ids.length === 0) {
    store.delete(DASHBOARD_BOARD_COOKIE);
  } else {
    store.set(DASHBOARD_BOARD_COOKIE, encodeBoardCookie(session.userId, ids), {
      httpOnly: true,
      // 跟登入的 cookie 同一個道理:只有真的用 https 服務才能標 secure(見 session.ts)。
      secure: (process.env.APP_BASE_URL ?? "").startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    });
  }
  revalidatePath("/dashboard");
  return {};
}
