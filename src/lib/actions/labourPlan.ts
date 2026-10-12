"use server";

import { revalidatePath } from "next/cache";
import type { Discipline } from "@/lib/labourPlan";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { canEditBudget } from "@/lib/actions/budget";
import { resyncBoardLabour } from "@/lib/actions/labourSheet";
import { loadSlotRates } from "@/lib/labourRate";
import { buildLabourSheet, type SlotRow } from "@/lib/labourSheet";
import {
  applySheetAmounts,
  summariseLabourPlan,
  type LabourPlanSummary,
  type WorkFactors,
} from "@/lib/labourPlan";
import { unitLabel, type OrgUnit } from "@/lib/orgUnits";
import { loadOrgUnits } from "@/lib/orgUnitsServer";

export type LabourPlanView = {
  boardName: string;
  summary: LabourPlanSummary;
  /** 單位標準月薪,元/月 —— 沒設過的單位不會出現。 */
  rates: { discipline: Discipline; monthlySalary: number }[];
  /** 目前設定的組織單位,照排序 —— 表格的欄位照它長。 */
  units: OrgUnit[];
  factors: WorkFactors;
  canEdit: boolean;
};

/**
 * 這塊看板的預算能不能編。
 *
 * 預算階段沒有自己的權限,它跟著看板走 —— 拿最上層第一列工作項去問既有的
 * 那支檢查,行為就跟改到期日、改預算那些地方一致。
 */
async function canEditBoardBudget(boardId: string): Promise<boolean> {
  const session = await requireSession();
  const first = await prisma.item.findFirst({
    where: { boardId, parentId: null, deletedAt: null },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  if (!first) return session.role === "ADMIN";
  return canEditBudget({ kind: "item", id: first.id }, session);
}

async function disciplineRateMap(): Promise<Record<Discipline, number>> {
  const rows = await prisma.disciplineRate.findMany();
  return Object.fromEntries(rows.map((r) => [r.discipline, r.monthlySalary]));
}

/**
 * 一個看板的人力規劃表:預算階段 × 單位,每一格是人月。
 *
 * 列是「預算階段」而不是看板最上層那幾列工作項 —— 預算是計畫,而 DVT1 與
 * DVT2 是兩段各自要編預算的計畫,即使它們對到看板上同一列。用工作項當列的
 * 話,那兩段會被擠成一列,誰也看不出哪一段花得多。
 */
export async function getLabourPlanView(boardId: string): Promise<LabourPlanView | null> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { name: true } });
  if (!board) return null;

  const phases = await prisma.budgetPhase.findMany({
    where: { boardId },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });

  const [cells, rates, settings, units, slotRows, phaseRows] = await Promise.all([
    prisma.labourPlan.findMany({
      where: { phaseId: { in: phases.map((p) => p.id) } },
      select: { phaseId: true, discipline: true, personMonths: true },
    }),
    disciplineRateMap(),
    getSystemSettings(),
    loadOrgUnits(),
    prisma.labourSlot.findMany({ where: { boardId }, include: { months: true } }),
    prisma.budgetPhase.findMany({ where: { boardId }, orderBy: { order: "asc" } }),
  ]);

  const factors = {
    workingDaysPerMonth: settings.workingDaysPerMonth,
    hoursPerDay: settings.hoursPerDay,
  };

  // 金額以人力表為準:有指到人、設了個人月薪的名額用他的月薪算(跟寫進預算的數字同一套)。
  const slots: SlotRow[] = slotRows.map((s) => ({
    id: s.id,
    discipline: s.discipline,
    label: s.label,
    func: s.func,
    userId: s.userId,
    ownerName: "",
    description: "",
    months: Object.fromEntries(s.months.map((m) => [m.month, Number(m.fte)])),
  }));
  const sheet = buildLabourSheet(
    phaseRows.map((p) => ({ id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate, itemId: p.itemId })),
    slots,
    rates,
    units,
    await loadSlotRates(slots)
  );

  return {
    boardName: board.name,
    // Decimal cannot cross the RSC boundary — turn it into a number here.
    summary: applySheetAmounts(
      summariseLabourPlan(
        phases,
        cells.map((c) => ({
          rowId: c.phaseId,
          discipline: c.discipline,
          personMonths: Number(c.personMonths),
        })),
        rates,
        units
      ),
      sheet
    ),
    rates: Object.entries(rates).map(([discipline, monthlySalary]) => ({
      discipline: discipline as Discipline,
      monthlySalary,
    })),
    units,
    factors,
    canEdit: await canEditBoardBudget(boardId),
  };
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
  const affected = await prisma.labourPlan.findMany({
    select: { phase: { select: { boardId: true } } },
    distinct: ["phaseId"],
  });
  // 重算走人力表那一支(它本來就是這些數字的來源),一個看板只要跑一次。
  const boardIds = [...new Set(affected.map((a) => a.phase.boardId))];
  for (const id of boardIds) await resyncBoardLabour(id);

  await logAudit(
    "COST",
    session.userId,
    `${unitLabel(await loadOrgUnits(), discipline)}標準月薪:${before?.monthlySalary ?? 0} → ${value} 元,連動重算 ${boardIds.length} 塊看板的人力預算`
  );
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return {};
}

export async function listDisciplineRates(): Promise<{ discipline: Discipline; monthlySalary: number }[]> {
  await requireSession();
  return prisma.disciplineRate.findMany({ orderBy: { discipline: "asc" } });
}
