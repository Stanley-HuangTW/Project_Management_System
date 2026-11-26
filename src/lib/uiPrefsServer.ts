import { prisma } from "@/lib/prisma";
import { parseUiPrefs, type UiPrefs } from "@/lib/uiPrefs";

/** 這個人自己的畫面設定(伺服器端讀,頁面渲染時帶給畫面)。 */
export async function loadUiPrefs(userId: string): Promise<UiPrefs> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { uiPrefs: true } });
  return parseUiPrefs(me?.uiPrefs);
}
