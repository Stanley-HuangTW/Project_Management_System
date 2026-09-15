import type { Discipline } from "@prisma/client";

/**
 * 人月與月薪。
 *
 * 成本本來只有一條路:每人一個時薪,工時 × 時薪。NPI 的人力預算實際上不是
 * 這樣談出來的 —— 編預算的時候還不知道會是誰做,談的是「EE 三個人月、ME
 * 兩個人月」。所以這裡有兩套換算,而且刻意分得很清楚:
 *
 *   規劃:人月 × 該單位的標準月薪 → 這個階段的人力預算
 *   實際:工時 × 那個人的時薪     → 已經花掉的人力成本
 *
 * 兩邊不會互相覆蓋,因為它們回答的是不同的問題:一個是「打算花多少」,
 * 一個是「實際花了多少」。
 */

export const DISCIPLINES: Discipline[] = ["EE", "SW", "QA", "ME", "PM", "OTHER"];

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  EE: "EE 電機",
  SW: "SW 軟體",
  QA: "QA 品保",
  ME: "ME 機構",
  PM: "PM 專案",
  OTHER: "其他",
};

/** 一個人月要幾個工作天、一天幾小時 —— 全公司共用的換算係數。 */
export type WorkFactors = { workingDaysPerMonth: number; hoursPerDay: number };

/**
 * 一個人實際算成本時用的時薪。順序是刻意的:
 *
 *   1. 個人時薪 —— 直接給的數字最沒有歧義,有填就用,所以現有的每一筆
 *      成本都不會因為多了月薪這條路而改變。
 *   2. 個人月薪 ÷ (每月工作天 × 每日工時)
 *   3. 所屬單位的標準月薪,同樣換算
 *
 * 三條都沒有就是 0 —— 沒有費率的人不會憑空產生成本。
 */
export function effectiveHourlyRate(
  user: {
    hourlyRate?: number | null;
    monthlySalary?: number | null;
    discipline?: Discipline | null;
  },
  disciplineRates: Partial<Record<Discipline, number>>,
  factors: WorkFactors
): number {
  if (user.hourlyRate && user.hourlyRate > 0) return user.hourlyRate;

  const hoursPerMonth = factors.workingDaysPerMonth * factors.hoursPerDay;
  if (hoursPerMonth <= 0) return 0;

  const monthly =
    user.monthlySalary && user.monthlySalary > 0
      ? user.monthlySalary
      : user.discipline
        ? (disciplineRates[user.discipline] ?? 0)
        : 0;
  return monthly > 0 ? monthly / hoursPerMonth : 0;
}

/** 這個時薪是哪裡來的 —— 讓畫面可以講清楚,而不是給一個來路不明的數字。 */
export function hourlyRateSource(
  user: {
    hourlyRate?: number | null;
    monthlySalary?: number | null;
    discipline?: Discipline | null;
  },
  disciplineRates: Partial<Record<Discipline, number>>
): "hourly" | "salary" | "discipline" | "none" {
  if (user.hourlyRate && user.hourlyRate > 0) return "hourly";
  if (user.monthlySalary && user.monthlySalary > 0) return "salary";
  if (user.discipline && (disciplineRates[user.discipline] ?? 0) > 0) return "discipline";
  return "none";
}

/** 規劃用:人月 × 單位標準月薪。單位沒有標準價就是 0 —— 不猜。 */
export function personMonthCost(
  personMonths: number,
  discipline: Discipline,
  disciplineRates: Partial<Record<Discipline, number>>
): number {
  const monthly = disciplineRates[discipline] ?? 0;
  if (personMonths <= 0 || monthly <= 0) return 0;
  return personMonths * monthly;
}

export type PlanCell = { itemId: string; discipline: Discipline; personMonths: number };

export type PlanRow = {
  itemId: string;
  itemName: string;
  /** 照 DISCIPLINES 的順序,每一格的人月與金額。 */
  cells: { discipline: Discipline; personMonths: number; amount: number }[];
  personMonths: number;
  amount: number;
};

export type LabourPlanSummary = {
  rows: PlanRow[];
  /** 每個單位跨所有階段的合計 —— 表格最底下那一列。 */
  byDiscipline: { discipline: Discipline; personMonths: number; amount: number }[];
  totalPersonMonths: number;
  totalAmount: number;
  /** 有填人月、但所屬單位還沒有標準月薪的格子 —— 這些人月算不出錢來。 */
  unpricedDisciplines: Discipline[];
};

/**
 * 階段 × 單位的交叉表。階段的順序由呼叫端給(也就是看板上的順序),
 * 單位的順序固定,所以每次看到的表格長得一樣。
 */
export function summariseLabourPlan(
  phases: { id: string; name: string }[],
  cells: PlanCell[],
  disciplineRates: Partial<Record<Discipline, number>>
): LabourPlanSummary {
  const byKey = new Map(cells.map((c) => [`${c.itemId}:${c.discipline}`, c.personMonths]));
  const unpriced = new Set<Discipline>();

  const rows: PlanRow[] = phases.map((phase) => {
    const rowCells = DISCIPLINES.map((discipline) => {
      const personMonths = byKey.get(`${phase.id}:${discipline}`) ?? 0;
      if (personMonths > 0 && !(disciplineRates[discipline] ?? 0)) unpriced.add(discipline);
      return {
        discipline,
        personMonths,
        amount: personMonthCost(personMonths, discipline, disciplineRates),
      };
    });
    return {
      itemId: phase.id,
      itemName: phase.name,
      cells: rowCells,
      personMonths: rowCells.reduce((t, c) => t + c.personMonths, 0),
      amount: rowCells.reduce((t, c) => t + c.amount, 0),
    };
  });

  const byDiscipline = DISCIPLINES.map((discipline) => {
    const column = rows.flatMap((r) => r.cells.filter((c) => c.discipline === discipline));
    return {
      discipline,
      personMonths: column.reduce((t, c) => t + c.personMonths, 0),
      amount: column.reduce((t, c) => t + c.amount, 0),
    };
  });

  return {
    rows,
    byDiscipline,
    totalPersonMonths: byDiscipline.reduce((t, d) => t + d.personMonths, 0),
    totalAmount: byDiscipline.reduce((t, d) => t + d.amount, 0),
    unpricedDisciplines: DISCIPLINES.filter((d) => unpriced.has(d)),
  };
}

/** 人月換算成工時 —— 拿來跟工時制的實際成本比對。 */
export function personMonthsToHours(personMonths: number, factors: WorkFactors): number {
  return personMonths * factors.workingDaysPerMonth * factors.hoursPerDay;
}
