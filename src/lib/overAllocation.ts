import type { MemberTask } from "@/lib/workload";

export type OverloadedDay = {
  date: string;
  pct: number;
  /** True when this person is on leave that day: any allocation at all is
   *  over capacity, because their capacity is zero. */
  onLeave: boolean;
};

export type TaskShare = {
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  allocationPct: number;
  /** Total float in working days, when the board's critical path is known.
   *  Null means "not computed"; 0 or less means moving it moves the project. */
  totalFloat: number | null;
};

export type Overload = {
  userId: string;
  userName: string;
  /** The worst day in the window. */
  peakPct: number;
  /** Every day over the threshold, so a one-day spike reads differently
   *  from a fortnight of it. */
  days: OverloadedDay[];
  /** How many of those days they are away for — work booked over someone's
   *  leave is a different problem from work booked too densely. */
  leaveDays: number;
  /** What is stacked on them, heaviest first. */
  tasks: TaskShare[];
};

const DAY_MS = 86_400_000;

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function coversDay(task: MemberTask, iso: string): boolean {
  if (!task.startDate || !task.endDate) return false;
  return toIso(task.startDate) <= iso && iso <= toIso(task.endDate);
}

/**
 * Who is booked past `thresholdPct` in a window, and what is doing it.
 *
 * The daily sum is what matters, not the weekly average: someone at 60% for
 * four days and 300% on the fifth averages out fine and is still going to
 * miss something on the fifth.
 *
 * Weekends are included, because a task's range covers them and this is a
 * question about commitments, not attendance.
 *
 * Someone's 休假 sets their capacity to zero for that day: 20% booked on a
 * day they are away is a real conflict, and averaging it against the rest of
 * the week is exactly how it gets missed.
 */
export function findOverAllocations(
  tasksByUser: Map<string, MemberTask[]>,
  users: { id: string; name: string }[],
  windowStart: Date,
  windowDays: number,
  thresholdPct: number,
  floatByItemId: Map<string, number> = new Map(),
  leaveDaysByUser: Map<string, Set<string>> = new Map()
): Overload[] {
  const isoDays: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    isoDays.push(toIso(new Date(windowStart.getTime() + i * DAY_MS)));
  }

  const result: Overload[] = [];
  for (const user of users) {
    const tasks = tasksByUser.get(user.id) ?? [];
    const days: OverloadedDay[] = [];
    const guiltyItemIds = new Set<string>();

    const leave = leaveDaysByUser.get(user.id) ?? new Set<string>();
    for (const iso of isoDays) {
      const active = tasks.filter((task) => coversDay(task, iso));
      const pct = active.reduce((sum, task) => sum + task.allocationPct, 0);
      const onLeave = leave.has(iso);
      // On leave, capacity is zero — so any booking at all is over it.
      if (pct > (onLeave ? 0 : thresholdPct)) {
        days.push({ date: iso, pct, onLeave });
        for (const task of active) guiltyItemIds.add(task.itemId);
      }
    }
    if (days.length === 0) continue;

    // Only the tasks that were actually on an overloaded day: a task earlier
    // that week is not what is overloading Thursday.
    const seen = new Set<string>();
    const shares: TaskShare[] = [];
    for (const task of tasks) {
      if (!guiltyItemIds.has(task.itemId) || seen.has(task.itemId)) continue;
      seen.add(task.itemId);
      shares.push({
        itemId: task.itemId,
        itemName: task.itemName,
        boardId: task.boardId,
        boardName: task.boardName,
        allocationPct: task.allocationPct,
        totalFloat: floatByItemId.get(task.itemId) ?? null,
      });
    }
    shares.sort((a, b) => b.allocationPct - a.allocationPct);

    result.push({
      userId: user.id,
      userName: user.name,
      peakPct: Math.max(...days.map((d) => d.pct)),
      days,
      leaveDays: days.filter((d) => d.onLeave).length,
      tasks: shares,
    });
  }

  return result.sort((a, b) => b.peakPct - a.peakPct);
}

/**
 * What could actually be moved to relieve someone.
 *
 * Not a levelling algorithm — a real one needs to know what may run in
 * parallel and what may not, which this system does not record. What it can
 * say honestly is which of the stacked tasks have float: those can slip
 * without moving the project's end date, and the ones on the critical path
 * cannot.
 */
export function movableTasks(overload: Overload): TaskShare[] {
  return overload.tasks.filter((task) => task.totalFloat !== null && task.totalFloat > 0);
}
