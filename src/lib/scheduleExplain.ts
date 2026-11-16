import type { GanttDurationMode } from "@prisma/client";
import type { DateRange } from "@/lib/gantt";
import { applyConstraint, CONSTRAINT_LABELS, pinsFinish, type ItemConstraint } from "@/lib/constraints";
import { computeScheduledRange, type DependentSummary, type RelationshipType } from "@/lib/predecessorLink";
import { withWeekday } from "@/lib/weekdayLabel";

/**
 * 項目的開始日 / 完成日「是因為什麼」算出來的 —— 跟排程引擎(predecessorLink.ts 的 recompute)
 * 同一個優先順序,但只回答「為什麼」,不寫任何東西:
 *
 *  1. 有子項目、自己沒有 Pred 的父項(Summary):取子項目最早的開始、最晚的完成;
 *  2. 有前置:取「開始最晚」的那一個前置(你得等最後一個前置才能動)算出來的日期;
 *  3. 沒有前置、「一律自己計算」的看板:Start(set) + Duration;
 *  4. 沒有前置也沒有 Start(set),但有「必須完成於」:完成日釘死、開始日往回推;
 *  5. 最後日期約束可以再把結果推移(不得早於 / 必須完成於);
 *  6. 以上都不是(傳統看板、沒有前置):就是手填的 Start / Days,沒有什麼好說明的。
 * 純函式,伺服器與測試都用同一份。
 */

export type ReasonSource = "rollup" | "pred" | "manual" | "constraint";
export type DateReason = { source: ReasonSource; text: string };

/** 這個前置在決定什麼:開始日、完成日,或日期約束的日期(約束跟著它走)。 */
export type PredDrives = "start" | "finish" | "constraint";

export type ExplainEntry = {
  itemId: string;
  /** 「1.2.1 名稱」,給說明文字用。 */
  label: string;
  /** 這條邊實際用的關係(Pred 那一格自己寫的,或這個項目 Link 欄的值)。 */
  relationship: string | null;
  /** 這條邊實際用的 Lag(Pred 那一格自己寫的,或 Lag 欄的值),沒有就是 0。 */
  lag: number;
  /** 前置現在的起訖;對面還沒排日期就是 null。 */
  range: DateRange | null;
};

export type ExplainInput = {
  mode: GanttDurationMode;
  holidays: Set<string>;
  /** 這個項目自己的天數;算不出來是 null。 */
  myDays: number | null;
  /** 一律自己計算的看板:沒有前置時看 Start(set) + Duration。 */
  alwaysComputed: boolean;
  /** 那兩個欄位的名稱(畫面上寫的是欄位名,例如 start(set)、duration)。 */
  manualStartName: string;
  manualDurationName: string;
  /** 父項統計:子項目(含各自的起訖);不是統計型父項就是 null。 */
  rollUp: { label: string; range: DateRange }[] | null;
  entries: ExplainEntry[];
  /** Start(set) + Duration 算出的範圍(一律自己計算的看板才有)。 */
  baseRange: DateRange | null;
  /** 現在實際生效的日期約束(跟著前置的話,日期已經是前置現在的日期)。 */
  constraint: ItemConstraint;
  /** 約束日期跟著哪個前置、哪個位置:說明文字用。 */
  constraintSource: { predItemId: string; text: string } | null;
  /** 有子項目(不管有沒有自己的 Pred):沒有 Pred 時它的日期是統計出來的,不是自己的天數。 */
  followsChildren: boolean;
};

/** 「相關項目」前置那一段的一列:比 DependentSummary 多 Lag、它決定了什麼、在哪個看板。 */
export type RelatedPredecessor = DependentSummary & {
  lag: number;
  /** 這個前置在決定這個項目的開始日 / 完成日 / 約束日期;沒有決定任何日期就是 null。 */
  drives: PredDrives | null;
  /** 一句話說明(drives 不是 null 時才有)。 */
  note: string | null;
  /** 前置在別的看板時是那個看板的名稱;同一個看板是 null。 */
  boardName: string | null;
};

/** 給畫面的結果(可以直接傳給瀏覽器)。 */
export type ItemScheduleExplanation = {
  start: DateReason | null;
  finish: DateReason | null;
  predecessors: RelatedPredecessor[];
};

export type ScheduleExplanation = {
  /** null = 沒有什麼要說明的(手填的日期)。 */
  start: DateReason | null;
  finish: DateReason | null;
  /** 每個前置在決定什麼(沒有決定任何日期的前置不在裡面)。 */
  drivers: Map<string, { drives: PredDrives; note: string }>;
};

const RELATIONSHIPS: string[] = ["FS", "FF", "SS", "SF"];
const iso = (date: Date) => date.toISOString().slice(0, 10);
const day = (date: Date) => withWeekday(iso(date));
const unitOf = (mode: GanttDurationMode) => (mode === "BUSINESS" ? "個工作天" : "天");
const lagText = (lag: number, mode: GanttDurationMode) =>
  lag === 0 ? "" : ` ${lag > 0 ? "+" : "−"} Lag ${Math.abs(lag)} ${unitOf(mode)}`;
const same = (a: DateRange, b: DateRange) => iso(a.start) === iso(b.start) && iso(a.end) === iso(b.end);

export function explainSchedule(input: ExplainInput): ScheduleExplanation {
  const { mode, holidays, myDays, constraint } = input;
  const drivers = new Map<string, { drives: PredDrives; note: string }>();
  const lengthText = myDays === null ? "天數" : `${input.manualDurationName} ${myDays} ${unitOf(mode)}`;

  // 1. 統計型父項
  if (input.rollUp && input.rollUp.length > 0) {
    const first = input.rollUp.reduce((a, b) => (b.range.start < a.range.start ? b : a));
    const last = input.rollUp.reduce((a, b) => (b.range.end > a.range.end ? b : a));
    return {
      start: { source: "rollup", text: `子項目統計:最早的子項目「${first.label}」開始於 ${day(first.range.start)}` },
      finish: { source: "rollup", text: `子項目統計:最晚的子項目「${last.label}」完成於 ${day(last.range.end)}` },
      drivers,
    };
  }

  // 2. 前置:開始最晚的那一個(跟 pickLatest 同一個規則,同一天取先出現的)
  type Candidate = { entry: ExplainEntry; relationship: RelationshipType; range: DateRange };
  let winner: Candidate | null = null;
  if (myDays !== null) {
    for (const entry of input.entries) {
      if (!entry.relationship || !RELATIONSHIPS.includes(entry.relationship) || !entry.range) continue;
      const range = computeScheduledRange(entry.range, myDays, entry.relationship as RelationshipType, entry.lag, mode, holidays);
      if (!range) continue;
      if (!winner || range.start.getTime() > winner.range.start.getTime()) {
        winner = { entry, relationship: entry.relationship as RelationshipType, range };
      }
    }
  }

  // 3 / 4. 沒有前置:Start(set) + Duration,或釘死的完成日往回推
  let base: DateRange | null = winner ? winner.range : input.alwaysComputed ? input.baseRange : null;
  let baseKind: "pred" | "manual" | "pinned" | null = winner ? "pred" : base ? "manual" : null;
  if (!base && !input.followsChildren && myDays !== null && pinsFinish(constraint)) {
    base = applyConstraint(
      { start: new Date(constraint.date!), end: new Date(constraint.date!) },
      myDays,
      constraint,
      mode,
      holidays
    ).range;
    baseKind = "pinned";
  }
  if (!base || !baseKind) return { start: null, finish: null, drivers };

  // 5. 日期約束再推一次
  const effective = applyConstraint(base, myDays, constraint, mode, holidays).range;
  const overridden = baseKind !== "pinned" && !same(effective, base);
  const constraintLabel = constraint.type ? `${CONSTRAINT_LABELS[constraint.type]} ${day(new Date(constraint.date!))}` : "";
  const sourceNote = input.constraintSource ? `(日期取自${input.constraintSource.text})` : "";

  if (baseKind === "pinned" || overridden) {
    if (input.constraintSource) {
      drivers.set(input.constraintSource.predItemId, {
        drives: "constraint",
        note: `日期約束「${constraintLabel}」的日期取自此項目`,
      });
    }
    const fromWhat =
      baseKind === "pred" && winner
        ? `,原本由前置「${winner.entry.label}」排出的是 ${day(base.start)} ~ ${day(base.end)}`
        : baseKind === "manual"
          ? `,原本由 ${input.manualStartName} 排出的是 ${day(base.start)} ~ ${day(base.end)}`
          : "";
    if (constraint.type === "MUST_FINISH_ON") {
      return {
        start: { source: "constraint", text: `日期約束「${constraintLabel}」${sourceNote}:完成日釘死,開始日由完成日往回推 ${myDays ?? ""} ${unitOf(mode)}${fromWhat}` },
        finish: { source: "constraint", text: `日期約束「${constraintLabel}」${sourceNote}:完成日被釘在這一天${fromWhat}` },
        drivers,
      };
    }
    return {
      start: { source: "constraint", text: `日期約束「${constraintLabel}」${sourceNote}:開始日被推到這一天${fromWhat}` },
      finish: { source: "constraint", text: `開始日 ${day(effective.start)} + ${lengthText}(開始日被日期約束推後)` },
      drivers,
    };
  }

  // 沒被約束推移
  if (baseKind === "manual") {
    return {
      start: { source: "manual", text: `${input.manualStartName} 手動設定的開始日` },
      finish: { source: "manual", text: `${input.manualStartName} ${day(base.start)} + ${lengthText}` },
      drivers,
    };
  }

  // baseKind === "pred"
  const { entry, relationship } = winner!;
  const pr = entry.range!;
  const lag = lagText(entry.lag, mode);
  const startsFromPred = relationship === "FS" || relationship === "SS";
  const predDate = relationship === "FS" || relationship === "FF" ? pr.end : pr.start;
  const predDateName = relationship === "FS" || relationship === "FF" ? "完成日" : "開始日";
  const reasonText = `前置「${entry.label}」${predDateName} ${day(predDate)}${relationship === "FS" ? "的下一個" + (mode === "BUSINESS" ? "工作日" : "日") : ""}${lag}(${relationship})`;
  drivers.set(entry.itemId, {
    drives: startsFromPred ? "start" : "finish",
    note: `此項目的${startsFromPred ? "開始日" : "完成日"}參照這個項目的${predDateName} ${day(predDate)}${lag}(${relationship})`,
  });
  return startsFromPred
    ? {
        start: { source: "pred", text: reasonText },
        finish: { source: "pred", text: `開始日 ${day(base.start)} + ${lengthText}` },
        drivers,
      }
    : {
        start: { source: "pred", text: `完成日 ${day(base.end)} 往回推 ${lengthText}` },
        finish: { source: "pred", text: reasonText },
        drivers,
      };
}
