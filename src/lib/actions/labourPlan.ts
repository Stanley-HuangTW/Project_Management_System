"use server";

import { revalidatePath } from "next/cache";
import type { Discipline } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { requireBudgetAdmin, canEditBudget } from "@/lib/actions/budget";
import {
  summariseLabourPlan,
  DISCIPLINE_LABELS,
  type LabourPlanSummary,
  type WorkFactors,
} from "@/lib/labourPlan";

/** 跟 budget.ts 裡那一支一樣的重新整理範圍。沒有共用是因為 budget.ts 是
 *  "use server",它的每個 export 都會變成 Server Action,而這支是同步的。 */
function revalidateScope(itemId: string) {
  revalidatePath("/dashboard");
  revalidatePath(`/items/${itemId}`);
}

export type LabourPlanView = {
  boardName: string;
  summary: LabourPlanSummary;
  /** 單位標準月薪,元/月 —— 沒設過的單位不會出現。 */
  rates: { discipline: Discipline; monthlySalary: number }[];
  factors: WorkFactors;
  canEdit: boolean;
};

async function disciplineRateMap(): Promise<Partial<Record<Discipline, number>>> {
  const rows = await prisma.disciplineRate.findMany();
  return Object.fromEntries(rows.map((r) => [r.discipline, r.monthlySalary]));
}

/**
 * 一個看板的人力規劃表:階段(最上層那幾列工作項)× 單位,每一格是人月。
 * 階段的順序就是看板上的順序,所以表格讀起來跟看板一致。
 */
export async function getLabourPlanView(boardId: string): Promise<LabourPlanView | null> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { name: true } });
  if (!board) return null;

  const phases = await prisma.item.findMany({
    where: { boardId, parentId: null, deletedAt: null },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });

  const [cells, rates, settings] = await Promise.all([
    prisma.labourPlan.findMany({
      where: { itemId: { in: phases.map((p) => p.id) } },
      select: { itemId: true, discipline: true, personMonths: true },
    }),
    disciplineRateMap(),
    getSystemSettings(),
  ]);

  const factors = {
    workingDaysPerMonth: settings.workingDaysPerMonth,
    hoursPerDay: settings.hoursPerDay,
  };

  return {
    boardName: board.name,
    // Decimal cannot cross the RSC boundary — turn it into a number here.
    summary: summariseLabourPlan(
      phases,
      cells.map((c) => ({ ...c, personMonths: Number(c.personMonths) })),
      rates
    ),
    rates: Object.entries(rates).map(([discipline, monthlySalary]) => ({
      discipline: discipline as Discipline,
      monthlySalary,
    })),
    factors,
    canEdit: phases.length > 0 && (await canEditBudget({ kind: "item", id: phases[0].id }, session)),
  };
}

/**
 * 改一格人月,然後把這個階段的人力預算重算寫回去。
 *
 * 人力那一列不是手填的金額,而是這張表的合計 —— 寫回 Budget 而不是每個
 * 讀取端各自去算,是因為儀表板的超支通知、專案群組的彙總、完工預估全部
 * 都讀同一張 Budget 表,一份來源才不會彼此打架。
 */
export async function setLabourPlanCell(
  itemId: string,
  discipline: Discipline,
  personMonths: number
): Promise<{ error?: string }> {
  const scope = { kind: "item" as const, id: itemId };
  const { session, resolved } = await requireBudgetAdmin(scope);
  if (!Number.isFinite(personMonths) || personMonths < 0) {
    return { error: "人月必須是 0 或正數" };
  }
  const value = Math.round(personMonths * 100) / 100;

  const before = await prisma.labourPlan.findUnique({
    where: { itemId_discipline: { itemId, discipline } },
  });
  if (value === 0) {
    await prisma.labourPlan.deleteMany({ where: { itemId, discipline } });
  } else {
    await prisma.labourPlan.upsert({
      where: { itemId_discipline: { itemId, discipline } },
      create: { itemId, discipline, personMonths: value, createdById: session.userId },
      update: { personMonths: value },
    });
  }

  await syncLabourBudget(itemId);
  revalidateScope(itemId);
  await logAudit(
    "COST",
    session.userId,
    `${resolved.name} 的${DISCIPLINE_LABELS[discipline]}人力規劃:${Number(before?.personMonths ?? 0)} → ${value} 人月`
  );
  return {};
}

/** 這個階段的人力預算 = 它每一格人月 × 該單位標準月薪的合計。 */
async function syncLabourBudget(itemId: string) {
  const [cells, rates] = await Promise.all([
    prisma.labourPlan.findMany({ where: { itemId }, select: { itemId: true, discipline: true, personMonths: true } }),
    disciplineRateMap(),
  ]);
  const { totalAmount } = summariseLabourPlan(
    [{ id: itemId, name: "" }],
    cells.map((c) => ({ ...c, personMonths: Number(c.personMonths) })),
    rates
  );

  if (cells.length === 0) {
    // 規劃整個清空了,人力預算就回到「沒有編列」,而不是留一個 0 在那裡
    // 假裝這個階段核准過 0 元的人力。
    await prisma.budget.deleteMany({ where: { itemId, category: "LABOUR" } });
    return;
  }
  await prisma.budget.upsert({
    where: { itemId_category: { itemId, category: "LABOUR" } },
    create: { itemId, category: "LABOUR", amount: Math.round(totalAmount), note: "由人力規劃表計算" },
    update: { amount: Math.round(totalAmount), note: "由人力規劃表計算" },
  });
}

/** 哪些階段的人力預算是規劃表算出來的 —— 那幾個階段不該再手動改金額。 */
export async function labourPlannedItemIds(itemIds: string[]): Promise<string[]> {
  const rows = await prisma.labourPlan.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true },
    distinct: ["itemId"],
  });
  return rows.map((r) => r.itemId);
}

/** 單位標準月薪。改了之後每個用到它的階段人力預算都要跟著重算。 */
export async function setDisciplineRate(
  discipline: Discipline,
  monthlySalary: number
): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.role !== "ADMIN") return { error: "只有管理者可以設定單位標準月薪" };
  if (!Number.isFinite(monthlySalary) || monthlySalary < 0) {
    return { error: "月薪必須是 0 或正數" };
  }
  const value = Math.round(monthlySalary);

  const before = await prisma.disciplineRate.findUnique({ where: { discipline } });
  if (value === 0) {
    await prisma.disciplineRate.deleteMany({ where: { discipline } });
  } else {
    await prisma.disciplineRate.upsert({
      where: { discipline },
      create: { discipline, monthlySalary: value },
      update: { monthlySalary: value },
    });
  }

  // 標準價變了,已經編出來的人力預算就跟著變 —— 否則表格上的金額跟 Budget
  // 裡的數字會從這一刻起悄悄對不起來。
  const affected = await prisma.labourPlan.findMany({ select: { itemId: true }, distinct: ["itemId"] });
  for (const { itemId } of affected) await syncLabourBudget(itemId);

  await logAudit(
    "COST",
    session.userId,
    `${DISCIPLINE_LABELS[discipline]}標準月薪:${before?.monthlySalary ?? 0} → ${value} 元,連動重算 ${affected.length} 個階段的人力預算`
  );
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return {};
}

export async function listDisciplineRates(): Promise<{ discipline: Discipline; monthlySalary: number }[]> {
  await requireSession();
  return prisma.disciplineRate.findMany({ orderBy: { discipline: "asc" } });
}
