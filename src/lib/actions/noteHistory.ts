"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buildNoteHistory, type NoteHistoryEntry } from "@/lib/noteHistory";

/**
 * 這位成員自己以前登記工時(專案與非專案)時寫過的備註,給備註欄當建議。
 * 只讀自己的:別人的備註可能寫著不該給你看的事。
 */
export async function getMyNoteHistory(): Promise<NoteHistoryEntry[]> {
  const session = await requireSession();
  const [project, activity] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { userId: session.userId, note: { not: null } },
      orderBy: { date: "desc" },
      take: 500,
      select: { itemId: true, note: true, date: true },
    }),
    prisma.activityTimeEntry.findMany({
      where: { userId: session.userId, note: { not: null } },
      orderBy: { date: "desc" },
      take: 500,
      select: { categoryId: true, note: true, date: true },
    }),
  ]);

  return buildNoteHistory([
    ...project.map((e) => ({ scope: `item:${e.itemId}`, text: e.note ?? "", date: e.date })),
    ...activity.map((e) => ({ scope: `cat:${e.categoryId}`, text: e.note ?? "", date: e.date })),
  ]).slice(0, 400);
}
