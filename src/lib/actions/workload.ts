"use server";

import { requireSession } from "@/lib/session";
import { resolveWorkloadScope } from "@/lib/dashboardScope";
import {
  computeTeamWorkload,
  computeMemberItemWorkload,
  type TeamWorkloadEntry,
  type MemberItemWorkloadEntry,
} from "@/lib/dashboard";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { getSystemSettings } from "@/lib/actions/systemSettings";

/** Same numbers as the workload card's day/week/month tabs, for an
 *  arbitrary date range instead — used by its "自訂" option. boardId
 *  mirrors the dashboard's own 看板篩選 filter. */
export async function getCustomWorkload(
  fromIso: string,
  toIso: string,
  boardId?: string
): Promise<{ team: TeamWorkloadEntry[]; memberItemWorkload: Record<string, MemberItemWorkloadEntry[]> }> {
  const session = await requireSession();
  if (!fromIso || !toIso || fromIso > toIso) {
    throw new Error("請選擇有效的日期區間");
  }

  const { boards: allBoards, workloadScope } = await resolveWorkloadScope(session);
  const boards = boardId ? allBoards.filter((b) => b.id === boardId) : allBoards;
  const holidays = toHolidaySet(await listHolidays());
  const range = { from: fromIso, to: toIso };
  const { ownerDefaultAllocationPct } = await getSystemSettings();

  const team = computeTeamWorkload(boards, workloadScope, range, holidays, ownerDefaultAllocationPct);
  const memberItemWorkload: Record<string, MemberItemWorkloadEntry[]> = {};
  for (const u of workloadScope) {
    memberItemWorkload[u.id] = computeMemberItemWorkload(boards, u.id, range, holidays, ownerDefaultAllocationPct);
  }

  return { team, memberItemWorkload };
}
