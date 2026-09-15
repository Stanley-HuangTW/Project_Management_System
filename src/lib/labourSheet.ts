import type { Discipline } from "@prisma/client";
import { DISCIPLINES, personMonthCost } from "@/lib/labourPlan";

/**
 * 人力堆疊表。
 *
 * LabourPlan(階段 × 單位人月)是結果,這裡是推算過程:一列是一個人力名額,
 * 每個月填 FTE,加總才得到人月。人力不是一次投入的 —— EE 在 EFS 就要全開,
 * QA 要等到有東西可測才進來,PM 從頭跟到尾但不是全職。只有逐月填,這些才
 *表達得出來。
 *
 * 月份軸來自預算階段的起訖日,不是看板的排程。預算表是初期評估,跟實際
 * 時程一定有落差 —— 那個落差是要拿來比的,不是要抹平的。
 */

export type MonthKey = string; // "YYYY-MM"

export type PhaseRow = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /** 對上的看板階段列;沒對上就不比較時程。 */
  itemId: string | null;
};

export type SlotRow = {
  id: string;
  discipline: Discipline;
  label: string;
  func: string;
  ownerName: string;
  description: string;
  /** 月份 → FTE。沒填的月份不會出現。 */
  months: Record<MonthKey, number>;
};

/** "2026-03" 這種鍵,從 "2026-03-16" 這種日期取出來。 */
export function monthKeyOf(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

function addMonth(key: MonthKey): MonthKey {
  const [year, month] = key.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * 表格的月份欄位:從最早的階段開始月,到最晚的階段結束月,中間一個都不跳。
 * 中間有空檔的月份仍然要留欄位,否則三月接六月會看起來像連續的。
 */
export function monthAxis(phases: { startDate: string; endDate: string }[]): MonthKey[] {
  if (phases.length === 0) return [];
  const starts = phases.map((p) => monthKeyOf(p.startDate));
  const ends = phases.map((p) => monthKeyOf(p.endDate));
  let cursor = starts.reduce((a, b) => (a < b ? a : b));
  const last = ends.reduce((a, b) => (a > b ? a : b));

  const axis: MonthKey[] = [];
  // 上限純粹是防呆:資料壞掉(結束日早於開始日幾十年)時不要無限跑。
  for (let i = 0; cursor <= last && i < 600; i++) {
    axis.push(cursor);
    cursor = addMonth(cursor);
  }
  return axis;
}

/** 哪個階段涵蓋這個月。重疊時取先排到的那個,所以人月不會被算兩次。 */
export function phaseOfMonth(phases: PhaseRow[], month: MonthKey): PhaseRow | null {
  return (
    phases.find((p) => monthKeyOf(p.startDate) <= month && month <= monthKeyOf(p.endDate)) ?? null
  );
}

export type SlotTotal = { slotId: string; personMonths: number; amount: number };

export type DisciplineTotal = {
  discipline: Discipline;
  personMonths: number;
  amount: number;
  /** 這個單位每個月加起來要幾個人 —— 過不過載看這一列。 */
  byMonth: Record<MonthKey, number>;
};

export type PhaseTotal = {
  phaseId: string;
  phaseName: string;
  personMonths: number;
  amount: number;
  /** 這個階段裡各單位分別多少人月,就是 LabourPlan 那張表的內容。 */
  byDiscipline: { discipline: Discipline; personMonths: number; amount: number }[];
};

export type LabourSheet = {
  months: MonthKey[];
  slotTotals: SlotTotal[];
  byDiscipline: DisciplineTotal[];
  byPhase: PhaseTotal[];
  /** 每個月全部單位加起來幾個人。 */
  headcountByMonth: Record<MonthKey, number>;
  totalPersonMonths: number;
  totalAmount: number;
  /** 有排人月、但單位沒有標準月薪,所以算不出錢的。 */
  unpricedDisciplines: Discipline[];
  /** 有填 FTE 但落在所有階段之外的月份 —— 那些人月進不了任何階段預算。 */
  monthsOutsideAnyPhase: MonthKey[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildLabourSheet(
  phases: PhaseRow[],
  slots: SlotRow[],
  disciplineRates: Partial<Record<Discipline, number>>
): LabourSheet {
  const months = monthAxis(phases);
  const unpriced = new Set<Discipline>();
  const orphanMonths = new Set<MonthKey>();

  const slotTotals: SlotTotal[] = slots.map((slot) => {
    const personMonths = Object.values(slot.months).reduce((t, fte) => t + fte, 0);
    if (personMonths > 0 && !(disciplineRates[slot.discipline] ?? 0)) unpriced.add(slot.discipline);
    return {
      slotId: slot.id,
      personMonths: round2(personMonths),
      amount: Math.round(personMonthCost(personMonths, slot.discipline, disciplineRates)),
    };
  });

  const headcountByMonth: Record<MonthKey, number> = {};
  const byDiscipline: DisciplineTotal[] = DISCIPLINES.map((discipline) => {
    const mine = slots.filter((s) => s.discipline === discipline);
    const byMonth: Record<MonthKey, number> = {};
    let personMonths = 0;
    for (const slot of mine) {
      for (const [month, fte] of Object.entries(slot.months)) {
        if (fte <= 0) continue;
        byMonth[month] = round2((byMonth[month] ?? 0) + fte);
        headcountByMonth[month] = round2((headcountByMonth[month] ?? 0) + fte);
        personMonths += fte;
        if (!phaseOfMonth(phases, month)) orphanMonths.add(month);
      }
    }
    return {
      discipline,
      personMonths: round2(personMonths),
      amount: Math.round(personMonthCost(personMonths, discipline, disciplineRates)),
      byMonth,
    };
  });

  // 每個月歸到涵蓋它的那個階段,於是「階段 × 單位人月」是算出來的,不是另外填的。
  const byPhase: PhaseTotal[] = phases.map((phase) => {
    const perDiscipline = DISCIPLINES.map((discipline) => {
      let personMonths = 0;
      for (const slot of slots.filter((s) => s.discipline === discipline)) {
        for (const [month, fte] of Object.entries(slot.months)) {
          // 重疊的階段只算一次,歸給先排到的那個。
          if (fte <= 0 || phaseOfMonth(phases, month)?.id !== phase.id) continue;
          personMonths += fte;
        }
      }
      return {
        discipline,
        personMonths: round2(personMonths),
        amount: Math.round(personMonthCost(personMonths, discipline, disciplineRates)),
      };
    });
    return {
      phaseId: phase.id,
      phaseName: phase.name,
      personMonths: round2(perDiscipline.reduce((t, d) => t + d.personMonths, 0)),
      amount: perDiscipline.reduce((t, d) => t + d.amount, 0),
      byDiscipline: perDiscipline,
    };
  });

  return {
    months,
    slotTotals,
    byDiscipline,
    byPhase,
    headcountByMonth,
    totalPersonMonths: round2(byDiscipline.reduce((t, d) => t + d.personMonths, 0)),
    totalAmount: byDiscipline.reduce((t, d) => t + d.amount, 0),
    unpricedDisciplines: DISCIPLINES.filter((d) => unpriced.has(d)),
    monthsOutsideAnyPhase: [...orphanMonths].sort(),
  };
}

const DAY_MS = 86_400_000;

function daysBetween(startIso: string, endIso: string): number {
  return Math.round((Date.parse(endIso) - Date.parse(startIso)) / DAY_MS) + 1;
}

export type PhaseVariance = {
  phaseId: string;
  phaseName: string;
  plannedStart: string;
  plannedEnd: string;
  plannedDays: number;
  /** 看板上那一列現在算出來的日期。沒對上看板階段時是 null。 */
  actualStart: string | null;
  actualEnd: string | null;
  actualDays: number | null;
  /** 現在比當初多幾天。負數 = 比當初短。 */
  daysVariance: number | null;
  /** 當初編的人力預算(元)。 */
  plannedAmount: number;
  /**
   * 照現在的工期,同樣的人力配置要花多少 —— 工期拉長 N%,人月就多 N%。
   * 這是「人數不變、時間拉長」這個假設下的推算,不是重排一次人力。
   */
  projectedAmount: number | null;
  amountVariance: number | null;
};

/**
 * 當初排的 vs 現在要的。
 *
 * 預算表的階段日期跟看板時程是分開的兩組數字,這支把它們對起來看。金額那
 * 一欄按工期等比例推算:工期多 20%,同一批人就要多待 20%,人力成本跟著多
 * 20%。真要重排人力當然不會這麼平均,但在「延誤了大概要多少錢」這個問題
 * 上,它給的是對的量級,而且假設講得出來。
 */
export function phaseVariances(
  phases: PhaseRow[],
  byPhase: PhaseTotal[],
  /** 看板上那幾列階段現在算出來的起訖日,itemId → { start, end }。 */
  actualRanges: Map<string, { start: string; end: string }>
): PhaseVariance[] {
  const amountOf = new Map(byPhase.map((p) => [p.phaseId, p.amount]));

  return phases.map((phase) => {
    const plannedDays = daysBetween(phase.startDate, phase.endDate);
    const plannedAmount = amountOf.get(phase.id) ?? 0;
    const actual = phase.itemId ? actualRanges.get(phase.itemId) : undefined;

    if (!actual) {
      return {
        phaseId: phase.id,
        phaseName: phase.name,
        plannedStart: phase.startDate,
        plannedEnd: phase.endDate,
        plannedDays,
        actualStart: null,
        actualEnd: null,
        actualDays: null,
        daysVariance: null,
        plannedAmount,
        projectedAmount: null,
        amountVariance: null,
      };
    }

    const actualDays = daysBetween(actual.start, actual.end);
    const projectedAmount =
      plannedDays > 0 ? Math.round((plannedAmount * actualDays) / plannedDays) : plannedAmount;

    return {
      phaseId: phase.id,
      phaseName: phase.name,
      plannedStart: phase.startDate,
      plannedEnd: phase.endDate,
      plannedDays,
      actualStart: actual.start,
      actualEnd: actual.end,
      actualDays,
      daysVariance: actualDays - plannedDays,
      plannedAmount,
      projectedAmount,
      amountVariance: projectedAmount - plannedAmount,
    };
  });
}
