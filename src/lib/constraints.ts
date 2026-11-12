import type { GanttDurationMode, ItemConstraintRefEdge, ItemConstraintType } from "@prisma/client";
import type { DateRange } from "@/lib/gantt";
import { shiftDate } from "@/lib/workday";

export type ItemConstraint = {
  type: ItemConstraintType | null;
  /** "YYYY-MM-DD" — meaningless without a type. */
  date: string | null;
};

export type ConstrainedRange = {
  range: DateRange;
  /** Set when the schedule cannot honour the constraint — a deadline the work
   *  already runs past. Null when there is nothing to report. */
  violation: string | null;
};

export const CONSTRAINT_LABELS: Record<ItemConstraintType, string> = {
  START_NO_EARLIER_THAN: "不得早於(開始)",
  FINISH_NO_LATER_THAN: "不得晚於(完成)",
  MUST_FINISH_ON: "必須完成於",
};

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Applies an item's date constraint to the range its predecessors produced.
 *
 * The three types behave differently on purpose:
 *
 *  - START_NO_EARLIER_THAN moves the item later when the chain would have
 *    started it too soon. A part that does not arrive until the 15th cannot
 *    be worked on the 12th, however free the schedule is.
 *  - MUST_FINISH_ON pins the finish and derives the start backwards. This
 *    overrides the chain in both directions — it is the fixed date everything
 *    else is arranged around.
 *  - FINISH_NO_LATER_THAN does NOT move anything. A deadline does not make
 *    work go faster; missing it is a fact to report, not a date to rewrite.
 *    Silently pulling the item earlier would break its predecessors and hide
 *    the very problem the deadline exists to surface.
 */
export function applyConstraint(
  range: DateRange,
  days: number | null,
  constraint: ItemConstraint,
  mode: GanttDurationMode,
  holidays: Set<string>
): ConstrainedRange {
  const date = parseIso(constraint.date);
  if (!constraint.type || !date) return { range, violation: null };
  const span = Math.max(Math.round(days ?? 1) - 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  if (constraint.type === "START_NO_EARLIER_THAN") {
    if (range.start.getTime() >= date.getTime()) return { range, violation: null };
    return {
      range: { start: date, end: shiftDate(date, span, mode, holidays) },
      violation: null,
    };
  }

  if (constraint.type === "MUST_FINISH_ON") {
    return {
      range: { start: shiftDate(date, -span, mode, holidays), end: date },
      violation: null,
    };
  }

  // FINISH_NO_LATER_THAN
  if (range.end.getTime() <= date.getTime()) return { range, violation: null };
  return {
    range,
    violation: `完成日 ${iso(range.end)} 已超過「不得晚於 ${iso(date)}」的期限`,
  };
}

/** True when the constraint fixes the finish date outright (MUST_FINISH_ON with
 *  a date) — then Start and Finish are both outputs, never free inputs. */
export function pinsFinish(constraint: ItemConstraint): boolean {
  return constraint.type === "MUST_FINISH_ON" && parseIso(constraint.date) !== null;
}

/**
 * The range a MUST_FINISH_ON constraint and a length describe on their own —
 * for an item with no predecessor and no start(set) to build a range from.
 * Without this a pinned finish date was only ever applied to a range something
 * else had already produced, so a task with just "必須完成於" and a duration
 * kept empty Start/Finish/Days and no Gantt bar. Null for any other constraint,
 * or when the length is unknown (nothing to count the start back with).
 */
export function pinnedRange(
  days: number | null,
  constraint: ItemConstraint,
  mode: GanttDurationMode,
  holidays: Set<string>
): DateRange | null {
  if (days === null || !pinsFinish(constraint)) return null;
  const placeholder = { start: parseIso(constraint.date)!, end: parseIso(constraint.date)! };
  return applyConstraint(placeholder, days, constraint, mode, holidays).range;
}

/**
 * 「必須完成於」跟前置依賴打架:前置依賴最快要排到 chain 這個區間才做得完,完成日卻晚於約束日,
 * 約束照樣勝出(日期被釘在約束上),也就是這個項目會在前置依賴還沒好的時候就開始。
 * chain 是前置依賴單獨排出來的區間(沒有前置、或算不出來就是 null);沒衝突回 null。
 * 前置依賴排出來比約束早,只是有餘裕,不算衝突。
 */
export function constraintConflict(
  chain: DateRange | null,
  days: number | null,
  constraint: ItemConstraint,
  mode: GanttDurationMode,
  holidays: Set<string>
): string | null {
  return constraintConflictDetail(chain, days, constraint, mode, holidays)?.message ?? null;
}

/** The same conflict in two lengths: the full explanation for the item card and
 *  pop-ups, and a one-liner for a list of several (the drag confirmation). */
export function constraintConflictDetail(
  chain: DateRange | null,
  days: number | null,
  constraint: ItemConstraint,
  mode: GanttDurationMode,
  holidays: Set<string>
): { message: string; short: string } | null {
  if (!chain || !pinsFinish(constraint)) return null;
  const date = parseIso(constraint.date)!;
  if (chain.end.getTime() <= date.getTime()) return null;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const pinned = pinnedRange(days, constraint, mode, holidays);
  return {
    message:
      `前置依賴最快要 ${iso(chain.start)} ~ ${iso(chain.end)} 才排得下,已晚於「${CONSTRAINT_LABELS.MUST_FINISH_ON} ${constraint.date}」。` +
      `目前照約束排在 ${pinned ? iso(pinned.start) : "(算不出來)"} ~ ${constraint.date},會在前置依賴還沒做完時就開始。請調整約束日期、天數或前置依賴`,
    short: `前置依賴最快 ${iso(chain.start)} ~ ${iso(chain.end)} 才排得下,晚於「${CONSTRAINT_LABELS.MUST_FINISH_ON} ${constraint.date}」`,
  };
}

/**
 * Why Start/Finish can't be edited by hand on an item whose finish is pinned,
 * and what to change instead. Null when the finish isn't pinned. Names no
 * column: the length lives in Days on a classic board and in the manual
 * duration column on an "always computed" one.
 */
export function pinnedScheduleReason(constraint: ItemConstraint): string | null {
  if (!pinsFinish(constraint)) return null;
  return `完成日被日期約束「${CONSTRAINT_LABELS.MUST_FINISH_ON} ${constraint.date}」固定,開始日由它往回推天數算出。要改請改日期約束,或改天數(自動排程的看板改手動天數欄位)`;
}

/** The constraint as a sentence, for the item card and the Gantt's hover. */
export function describeConstraint(constraint: ItemConstraint): string | null {
  if (!constraint.type || !constraint.date) return null;
  return `${CONSTRAINT_LABELS[constraint.type]} ${constraint.date}`;
}

/** 約束日期跟著前置任務的哪個位置:開始日、完成日,或它期間內的第 N 天。 */
export type ConstraintRefEdge = ItemConstraintRefEdge;

export const CONSTRAINT_REF_EDGE_LABELS: Record<ConstraintRefEdge, string> = {
  START: "起始時間",
  FINISH: "結束時間",
  DAY: "期間內的某一天",
};

/** 設定約束時的日期來源:固定日期,或這個項目某個前置任務的起始 / 結束 / 期間內第 N 天(日期跟著它走)。 */
export type ConstraintSourceInput =
  | { kind: "FIXED"; date: string }
  | {
      kind: "PRED";
      predItemId: string;
      edge: ConstraintRefEdge;
      /** edge 為 DAY 時:前置任務期間的第幾天(從 1 算起)。 */
      day?: number;
    };

/** 約束日期取自前置任務時,項目身上存的那幾個欄位 + 存下來的日期。 */
export type StoredConstraint = {
  constraintType: ItemConstraintType | null;
  constraintDate: string | null;
  constraintRefItemId?: string | null;
  constraintRefEdge?: ConstraintRefEdge | null;
  constraintRefDay?: number | null;
};

/** 前置任務期間的第 n 天(從 1 算起);期間不夠 n 天就取最後一天。refItemId 讓呼叫端依前置任務自己的工作天 / 日曆天算。 */
export type NthDayOf = (refItemId: string, range: DateRange, n: number) => Date;

const calendarNthDay: NthDayOf = (_refItemId, range, n) => {
  const day = new Date(range.start.getTime() + Math.max(n - 1, 0) * 86_400_000);
  return day.getTime() > range.end.getTime() ? range.end : day;
};

/**
 * 項目現在實際生效的約束。
 *
 * 約束日期可以是固定的,也可以跟著這個項目的某個前置任務的開始日或完成日走。跟著走的時候,日期取自
 * 前置任務**現在**的起訖(readRange),前置任務一動,約束就跟著動;排程引擎把算出來的日期存回
 * constraintDate,所以只讀 constraintDate 的地方(畫面、匯出、複製)永遠看得到一個日期。
 *
 * 跟著走的前提是:前置任務還在這個項目的 Pred 裡。不在了(被拿掉、被刪、搬到別處)就沿用存下來的日期當固定日期,
 * refDropped 回 true,讓引擎把「跟著前置任務」這件事清掉——不會因為前置任務消失就讓約束消失,也不會
 * 悄悄跟著一個已經沒有關係的項目走。前置任務還沒有日期(算不出來)時,同樣沿用存下來的日期、不清掉。
 */
export function resolveConstraint(
  item: StoredConstraint,
  predecessorIds: readonly string[],
  readRange: (itemId: string) => DateRange | null,
  nthDayOf: NthDayOf = calendarNthDay
): { constraint: ItemConstraint; followsPred: boolean; refDropped: boolean } {
  const stored: ItemConstraint = { type: item.constraintType, date: item.constraintDate };
  const refId = item.constraintRefItemId ?? null;
  const edge = item.constraintRefEdge ?? null;
  if (!item.constraintType || !refId || !edge) return { constraint: stored, followsPred: false, refDropped: false };
  if (!predecessorIds.includes(refId)) return { constraint: stored, followsPred: false, refDropped: true };
  const range = readRange(refId);
  if (!range) return { constraint: stored, followsPred: true, refDropped: false };
  const day = edge === "START" ? range.start : edge === "FINISH" ? range.end : nthDayOf(refId, range, item.constraintRefDay ?? 1);
  return { constraint: { type: item.constraintType, date: day.toISOString().slice(0, 10) }, followsPred: true, refDropped: false };
}

/** 約束日期的來源,給畫面與稽核紀錄用的一句話:「前置任務 1.2 xxx 的結束時間」「…期間的第 3 天」。 */
export function describeConstraintSource(refLabel: string, edge: ConstraintRefEdge, day?: number | null): string {
  return edge === "DAY"
    ? `前置任務 ${refLabel} 期間的第 ${day ?? 1} 天`
    : `前置任務 ${refLabel} 的${CONSTRAINT_REF_EDGE_LABELS[edge]}`;
}
