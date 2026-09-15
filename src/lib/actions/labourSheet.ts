"use server";

import { revalidatePath } from "next/cache";
import type { Discipline } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { canEditBudget } from "@/lib/actions/budget";
import { getItemDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { boardWithDataArgs } from "@/types/board";
import {
  buildLabourSheet,
  phaseVariances,
  type LabourSheet,
  type PhaseRow,
  type PhaseVariance,
  type SlotRow,
} from "@/lib/labourSheet";

export type LabourSheetView = {
  boardName: string;
  phases: PhaseRow[];
  milestones: {
    id: string;
    track: string;
    name: string;
    startDate: string;
    endDate: string;
    color: string;
  }[];
  slots: SlotRow[];
  sheet: LabourSheet;
  variances: PhaseVariance[];
  /** 看板上可以對應的階段列(最上層那幾列),給對應下拉用。 */
  boardPhases: { id: string; name: string }[];
  rates: { discipline: Discipline; monthlySalary: number }[];
  canEdit: boolean;
};

async function rateMap(): Promise<Partial<Record<Discipline, number>>> {
  const rows = await prisma.disciplineRate.findMany();
  return Object.fromEntries(rows.map((r) => [r.discipline, r.monthlySalary]));
}

async function requireSheetAdmin(boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const phases = await prisma.item.findMany({
    where: { boardId, parentId: null, deletedAt: null },
    orderBy: { order: "asc" },
    select: { id: true },
    take: 1,
  });
  // 權限跟預算同一套:能編這個看板預算的人才能動人力表。看板還沒有任何
  // 工作項時沒有階段可以當範圍,那就只有管理者。
  const allowed = phases[0]
    ? await canEditBudget({ kind: "item", id: phases[0].id }, session)
    : session.role === "ADMIN";
  if (!allowed) {
    throw new Error("權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯人力預算");
  }
  return session;
}

function revalidateBoard(boardId: string) {
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");
}

/** 看板上每一列階段現在算出來的起訖日,用來跟預算表的日期比。 */
async function actualPhaseRanges(boardId: string): Promise<Map<string, { start: string; end: string }>> {
  const board = await prisma.board.findUnique({ where: { id: boardId }, ...boardWithDataArgs });
  const ranges = new Map<string, { start: string; end: string }>();
  if (!board?.ganttStartColumnId || !board.ganttDurationColumnId) return ranges;

  const holidays = toHolidaySet(await listHolidays());
  for (const item of board.items) {
    if (item.parentId !== null) continue;
    const range = getItemDateRange(
      item,
      board.ganttStartColumnId,
      board.ganttDurationColumnId,
      board.ganttDurationMode,
      holidays
    );
    if (range) {
      ranges.set(item.id, {
        start: range.start.toISOString().slice(0, 10),
        end: range.end.toISOString().slice(0, 10),
      });
    }
  }
  return ranges;
}

export async function getLabourSheetView(boardId: string): Promise<LabourSheetView | null> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { name: true } });
  if (!board) return null;

  const [phaseRows, milestones, slotRows, rates, boardPhases, actual] = await Promise.all([
    prisma.budgetPhase.findMany({ where: { boardId }, orderBy: { order: "asc" } }),
    prisma.planMilestone.findMany({ where: { boardId }, orderBy: [{ track: "asc" }, { order: "asc" }] }),
    prisma.labourSlot.findMany({
      where: { boardId },
      orderBy: { order: "asc" },
      include: { months: true, user: { select: { name: true } } },
    }),
    rateMap(),
    prisma.item.findMany({
      where: { boardId, parentId: null, deletedAt: null },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
    actualPhaseRanges(boardId),
  ]);

  const phases: PhaseRow[] = phaseRows.map((p) => ({
    id: p.id,
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate,
    itemId: p.itemId,
  }));

  // Decimal 不能過 RSC 邊界。
  const slots: SlotRow[] = slotRows.map((s) => ({
    id: s.id,
    discipline: s.discipline,
    label: s.label,
    func: s.func,
    ownerName: s.user?.name ?? s.ownerLabel,
    description: s.description,
    months: Object.fromEntries(s.months.map((m) => [m.month, Number(m.fte)])),
  }));

  const sheet = buildLabourSheet(phases, slots, rates);

  return {
    boardName: board.name,
    phases,
    milestones,
    slots,
    sheet,
    variances: phaseVariances(phases, sheet.byPhase, actual),
    boardPhases,
    rates: Object.entries(rates).map(([discipline, monthlySalary]) => ({
      discipline: discipline as Discipline,
      monthlySalary,
    })),
    canEdit: boardPhases[0]
      ? await canEditBudget({ kind: "item", id: boardPhases[0].id }, session)
      : session.role === "ADMIN",
  };
}

/**
 * 把人力表算出來的階段 × 單位人月寫回 LabourPlan 與 Budget。
 *
 * 人月不再手填,所以每次人力表一動就重算 —— 儀表板的超支通知、專案群組的
 * 彙總、完工預估全部讀 Budget,一份來源才不會彼此打架。只寫有對應到看板
 * 階段列的那些,因為 LabourPlan/Budget 是掛在工作項上的。
 */
async function syncFromSheet(boardId: string) {
  const [phaseRows, slotRows, rates] = await Promise.all([
    prisma.budgetPhase.findMany({ where: { boardId }, orderBy: { order: "asc" } }),
    prisma.labourSlot.findMany({ where: { boardId }, include: { months: true } }),
    rateMap(),
  ]);

  const phases: PhaseRow[] = phaseRows.map((p) => ({
    id: p.id,
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate,
    itemId: p.itemId,
  }));
  const slots: SlotRow[] = slotRows.map((s) => ({
    id: s.id,
    discipline: s.discipline,
    label: s.label,
    func: s.func,
    ownerName: "",
    description: "",
    months: Object.fromEntries(s.months.map((m) => [m.month, Number(m.fte)])),
  }));

  const { byPhase } = buildLabourSheet(phases, slots, rates);
  const itemOf = new Map(phases.map((p) => [p.id, p.itemId]));

  for (const phase of byPhase) {
    const itemId = itemOf.get(phase.phaseId);
    if (!itemId) continue;

    await prisma.labourPlan.deleteMany({ where: { itemId } });
    const cells = phase.byDiscipline.filter((d) => d.personMonths > 0);
    if (cells.length > 0) {
      await prisma.labourPlan.createMany({
        data: cells.map((d) => ({
          itemId,
          discipline: d.discipline,
          personMonths: d.personMonths,
        })),
      });
    }

    if (phase.amount > 0) {
      await prisma.budget.upsert({
        where: { itemId_category: { itemId, category: "LABOUR" } },
        create: { itemId, category: "LABOUR", amount: phase.amount, note: "由人力表計算" },
        update: { amount: phase.amount, note: "由人力表計算" },
      });
    } else {
      // 一個人月都沒排,人力預算就回到「沒有編列」,而不是留一個 0 在那裡
      // 假裝這個階段核准過 0 元的人力。
      await prisma.budget.deleteMany({ where: { itemId, category: "LABOUR" } });
    }
  }
}

// ---- 預算階段 ----

export async function upsertBudgetPhase(
  boardId: string,
  input: { id?: string; name: string; startDate: string; endDate: string; itemId: string | null }
): Promise<{ error?: string }> {
  const session = await requireSheetAdmin(boardId);
  const name = input.name.trim();
  if (!name) return { error: "階段名稱不可為空" };
  if (!input.startDate || !input.endDate) return { error: "起訖日期都要填" };
  if (input.endDate < input.startDate) return { error: "結束日不可早於開始日" };

  if (input.id) {
    await prisma.budgetPhase.update({
      where: { id: input.id },
      data: { name, startDate: input.startDate, endDate: input.endDate, itemId: input.itemId },
    });
  } else {
    const count = await prisma.budgetPhase.count({ where: { boardId } });
    await prisma.budgetPhase.create({
      data: {
        boardId,
        name,
        startDate: input.startDate,
        endDate: input.endDate,
        itemId: input.itemId,
        order: count,
        createdById: session.userId,
      },
    });
  }

  await syncFromSheet(boardId);
  await logAudit("COST", session.userId, `人力表階段「${name}」:${input.startDate} ~ ${input.endDate}`, boardId);
  revalidateBoard(boardId);
  return {};
}

export async function deleteBudgetPhase(boardId: string, id: string): Promise<{ error?: string }> {
  const session = await requireSheetAdmin(boardId);
  const phase = await prisma.budgetPhase.findUnique({ where: { id }, select: { name: true, itemId: true } });
  if (!phase) return { error: "找不到這個階段" };

  await prisma.budgetPhase.delete({ where: { id } });
  // 這個階段不在了,它推算出來的人力預算也要跟著收回,否則會留下一筆
  // 沒有任何東西支撐的核准金額。
  if (phase.itemId) {
    await prisma.labourPlan.deleteMany({ where: { itemId: phase.itemId } });
    await prisma.budget.deleteMany({ where: { itemId: phase.itemId, category: "LABOUR" } });
  }
  await syncFromSheet(boardId);
  await logAudit("COST", session.userId, `刪除人力表階段「${phase.name}」`, boardId);
  revalidateBoard(boardId);
  return {};
}

// ---- 里程碑 ----

export async function upsertPlanMilestone(
  boardId: string,
  input: {
    id?: string;
    track: string;
    name: string;
    startDate: string;
    endDate: string;
    color?: string;
  }
): Promise<{ error?: string }> {
  const session = await requireSheetAdmin(boardId);
  const name = input.name.trim();
  const track = input.track.trim() || "里程碑";
  if (!name) return { error: "里程碑名稱不可為空" };
  if (!input.startDate || !input.endDate) return { error: "起訖日期都要填" };
  if (input.endDate < input.startDate) return { error: "結束日不可早於開始日" };

  if (input.id) {
    await prisma.planMilestone.update({
      where: { id: input.id },
      data: {
        track,
        name,
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.color ? { color: input.color } : {}),
      },
    });
  } else {
    const count = await prisma.planMilestone.count({ where: { boardId, track } });
    await prisma.planMilestone.create({
      data: {
        boardId,
        track,
        name,
        startDate: input.startDate,
        endDate: input.endDate,
        color: input.color ?? "#fdab3d",
        order: count,
      },
    });
  }

  await logAudit("COST", session.userId, `人力表里程碑「${name}」:${input.startDate} ~ ${input.endDate}`, boardId);
  revalidateBoard(boardId);
  return {};
}

export async function deletePlanMilestone(boardId: string, id: string): Promise<{ error?: string }> {
  const session = await requireSheetAdmin(boardId);
  const milestone = await prisma.planMilestone.findUnique({ where: { id }, select: { name: true } });
  if (!milestone) return { error: "找不到這個里程碑" };
  await prisma.planMilestone.delete({ where: { id } });
  await logAudit("COST", session.userId, `刪除人力表里程碑「${milestone.name}」`, boardId);
  revalidateBoard(boardId);
  return {};
}

// ---- 人力名額 ----

export async function upsertLabourSlot(
  boardId: string,
  input: {
    id?: string;
    discipline: Discipline;
    label: string;
    func: string;
    userId: string | null;
    ownerLabel: string;
    description: string;
  }
): Promise<{ error?: string }> {
  const session = await requireSheetAdmin(boardId);
  const label = input.label.trim();
  if (!label) return { error: "名額代號不可為空,例如 EE1" };

  const data = {
    discipline: input.discipline,
    label,
    func: input.func.trim(),
    userId: input.userId,
    // 指到人之後就不需要 TBH 那行字了。
    ownerLabel: input.userId ? "" : input.ownerLabel.trim() || "TBH",
    description: input.description.trim(),
  };

  if (input.id) {
    await prisma.labourSlot.update({ where: { id: input.id }, data });
  } else {
    const count = await prisma.labourSlot.count({ where: { boardId } });
    await prisma.labourSlot.create({
      data: { ...data, boardId, order: count, createdById: session.userId },
    });
  }

  await syncFromSheet(boardId);
  revalidateBoard(boardId);
  return {};
}

export async function deleteLabourSlot(boardId: string, id: string): Promise<{ error?: string }> {
  const session = await requireSheetAdmin(boardId);
  const slot = await prisma.labourSlot.findUnique({ where: { id }, select: { label: true } });
  if (!slot) return { error: "找不到這個名額" };
  await prisma.labourSlot.delete({ where: { id } });
  await syncFromSheet(boardId);
  await logAudit("COST", session.userId, `刪除人力名額「${slot.label}」`, boardId);
  revalidateBoard(boardId);
  return {};
}

/** 一格:某個名額某個月投入多少。0 就把那一格清掉。 */
export async function setLabourSlotMonth(
  boardId: string,
  slotId: string,
  month: string,
  fte: number
): Promise<{ error?: string }> {
  await requireSheetAdmin(boardId);
  if (!Number.isFinite(fte) || fte < 0) return { error: "投入必須是 0 或正數" };
  if (fte > 20) return { error: "一個名額一個月不會超過 20 個人月,請確認是不是填錯了" };
  const value = Math.round(fte * 100) / 100;

  if (value === 0) {
    await prisma.labourSlotMonth.deleteMany({ where: { slotId, month } });
  } else {
    await prisma.labourSlotMonth.upsert({
      where: { slotId_month: { slotId, month } },
      create: { slotId, month, fte: value },
      update: { fte: value },
    });
  }

  await syncFromSheet(boardId);
  revalidateBoard(boardId);
  return {};
}

/**
 * 一整列一次填完:從某個月填到某個月,每個月同樣的 FTE。
 *
 * 逐格點十二次是這張表最難用的地方,而「這個人從三月做到八月」本來就是
 * 一句話講得完的事。
 */
export async function fillLabourSlotRange(
  boardId: string,
  slotId: string,
  fromMonth: string,
  toMonth: string,
  fte: number
): Promise<{ error?: string }> {
  await requireSheetAdmin(boardId);
  if (!Number.isFinite(fte) || fte < 0 || fte > 20) return { error: "投入必須介於 0 到 20" };
  if (toMonth < fromMonth) return { error: "結束月份不可早於開始月份" };
  const value = Math.round(fte * 100) / 100;

  const months: string[] = [];
  let cursor = fromMonth;
  for (let i = 0; cursor <= toMonth && i < 600; i++) {
    months.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    cursor = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  }

  await prisma.labourSlotMonth.deleteMany({ where: { slotId, month: { in: months } } });
  if (value > 0) {
    await prisma.labourSlotMonth.createMany({
      data: months.map((month) => ({ slotId, month, fte: value })),
    });
  }

  await syncFromSheet(boardId);
  revalidateBoard(boardId);
  return {};
}
