import { prisma } from "@/lib/prisma";

/** 一個人一天最多登記幾小時。 */
export const DAILY_LIMIT_HOURS = 24;

/**
 * 這個人這一天已經登記的時數(專案未退回 + 非專案未退回),可以排除正在修改的那一筆,
 * 修改時才不會把自己算兩次。
 */
export async function hoursAlreadyLoggedOn(
  userId: string,
  date: string,
  exclude: { projectEntryId?: string; activityEntryId?: string } = {}
): Promise<number> {
  const [project, activity] = await Promise.all([
    prisma.timeEntry.aggregate({
      where: {
        userId,
        date,
        status: { not: "REJECTED" },
        ...(exclude.projectEntryId ? { id: { not: exclude.projectEntryId } } : {}),
      },
      _sum: { hours: true },
    }),
    prisma.activityTimeEntry.aggregate({
      where: {
        userId,
        date,
        status: { not: "REJECTED" },
        ...(exclude.activityEntryId ? { id: { not: exclude.activityEntryId } } : {}),
      },
      _sum: { hours: true },
    }),
  ]);
  return Number(project._sum.hours ?? 0) + Number(activity._sum.hours ?? 0);
}
