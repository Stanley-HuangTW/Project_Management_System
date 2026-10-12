"use server";

import { revalidatePath } from "next/cache";
import type { Discipline } from "@/lib/labourPlan";
import type { OrgUnit } from "@/lib/orgUnits";
import { loadOrgUnits } from "@/lib/orgUnitsServer";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { getItemDateRange } from "@/lib/gantt";
import {
  resolveGroupRoleAccess,
  canEditLabourSlot,
  FULL_GROUP_ACCESS,
  type GroupRoleAccess,
} from "@/lib/groupRoles";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { MAX_FTE, FTE_CAP_MESSAGE } from "@/lib/labourSheet";
import { loadSlotRates } from "@/lib/labourRate";
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
  /** 帶的顏色跟著階段走,所以 PhaseRow 之外另外給一張對照表。 */
  phaseColors: Record<string, string>;
  phases: PhaseRow[];
  milestones: {
    id: string;
    typeId: string;
    name: string;
    startDate: string;
    endDate: string;
    color: string;
  }[];
  /** 里程碑類型,照排序 —— 一個類型就是一排。 */
  milestoneTypes: { id: string; name: string }[];
  /** 每一列多帶一個 canEdit——名額的組織單位不同,能編的人也不同。 */
  slots: (SlotRow & { canEdit: boolean })[];
  sheet: LabourSheet;
  variances: PhaseVariance[];
  /** 看板上可以對應的階段列(最上層那幾列),給對應下拉用。 */
  boardPhases: { id: string; name: string }[];
  rates: { discipline: Discipline; monthlySalary: number }[];
  /** 目前設定的組織單位,照排序 —— 表格的欄位與下拉選單都照它長。 */
  units: OrgUnit[];
  /** 名額可以指給誰 —— 名額常常先掛 TBH,招到人再指過去。 */
  assignableUsers: { id: string; name: string }[];
  /**
   * 名額 id → 個人月薪,Excel 匯出算金額用。薪資只有管理者看得到,所以其他人拿到的是空的
   * (他們的匯出檔,有指到人的名額就照單位標準月薪列,金額與畫面不同)。
   */
  slotRates: Record<string, number>;
  /** 國定假日。對話框要算工作天,規則得跟甘特圖同一套。 */
  holidays: string[];
  /** 時程規劃(階段帶、里程碑、里程碑類型)——Team Leader/PMD/管理者。 */
  canEditSchedule: boolean;
  /** 「+ 人力名額」按鈕要不要顯示——有排程權,或至少是某個單位的 DM。 */
  canAddSlot: boolean;
};

async function rateMap(): Promise<Record<Discipline, number>> {
  const rows = await prisma.disciplineRate.findMany();
  return Object.fromEntries(rows.map((r) => [r.discipline, r.monthlySalary]));
}

/**
 * 這個人在這塊看板上,分組角色給他的存取權。
 *
 * 一塊看板可能不只一個分組,而人力表是整塊看板共用的一張表,不屬於哪一個
 * 分組——所以跟 canEditBudget 的 phase 範圍同一個道理,把這塊看板上「任一」
 * 分組給的角色都併進來問,不挑一個分組出來。
 */
async function loadBoardRoleAccess(
  boardId: string,
  session: Awaited<ReturnType<typeof requireSession>>
): Promise<GroupRoleAccess> {
  // 管理者、或這塊看板的建立者,兩者都是「什麼都能編」,不用再問分組角色。
  if (session.role === "ADMIN") return FULL_GROUP_ACCESS;
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true } });
  if (board?.ownerId === session.userId) return FULL_GROUP_ACCESS;
  const groups = await prisma.group.findMany({ where: { boardId }, select: { id: true } });
  if (groups.length === 0) return { hasScheduleRole: false, disciplines: new Set() };
  const assignments = await prisma.groupRoleAssignment.findMany({
    where: { groupId: { in: groups.map((g) => g.id) }, userId: session.userId },
    select: { role: true },
  });
  return resolveGroupRoleAccess(assignments);
}

/** 時程規劃:階段、里程碑、里程碑類型。只有 Team Leader/PMD/管理者能動。 */
export async function requireScheduleAdmin(boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const access = await loadBoardRoleAccess(boardId, session);
  if (!access.hasScheduleRole) {
    throw new Error("權限不足:只有管理者、專案建立者與該分組的 Team Leader/PMD 可以異動時程規劃(階段/里程碑)");
  }
  return session;
}

/** 人力設定:單一名額的指定人員、月份數字、新增/刪除/改組織單位。 */
async function requireSlotAdmin(boardId: string, discipline: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const access = await loadBoardRoleAccess(boardId, session);
  if (!canEditLabourSlot(access, discipline)) {
    throw new Error("權限不足:只有管理者與該單位的 DM(或該分組的 Team Leader/PMD)可以編輯這個名額");
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

  const [
    phaseRows,
    milestones,
    milestoneTypes,
    slotRows,
    rates,
    boardPhases,
    actual,
    units,
    assignableUsers,
    holidayRows,
  ] = await Promise.all([
    prisma.budgetPhase.findMany({ where: { boardId }, orderBy: { order: "asc" } }),
    prisma.planMilestone.findMany({ where: { boardId }, orderBy: { order: "asc" } }),
    prisma.milestoneType.findMany({ where: { boardId }, orderBy: [{ order: "asc" }, { name: "asc" }] }),
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
    loadOrgUnits(),
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    listHolidays(),
  ]);

  const phases: PhaseRow[] = phaseRows.map((p) => ({
    id: p.id,
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate,
    itemId: p.itemId,
  }));

  const access = await loadBoardRoleAccess(boardId, session);

  // Decimal 不能過 RSC 邊界。
  const slots: (SlotRow & { canEdit: boolean })[] = slotRows.map((s) => ({
    id: s.id,
    discipline: s.discipline,
    label: s.label,
    func: s.func,
    userId: s.userId,
    ownerName: s.user?.name ?? s.ownerLabel,
    description: s.description,
    months: Object.fromEntries(s.months.map((m) => [m.month, Number(m.fte)])),
    canEdit: canEditLabourSlot(access, s.discipline),
  }));

  const allSlotRates = await loadSlotRates(slots);
  const sheet = buildLabourSheet(phases, slots, rates, units, allSlotRates);
  // 個人月薪只有管理者看得到(設定月薪本來就只有管理者):每個名額自己的金額 = 他的月薪 × 人月,等於把月薪
  // 送到畫面上。其他人只看得到單位、階段的合計(跟原本一樣,合計是看不出誰的)。
  const isAdmin = session.role === "ADMIN";
  if (!isAdmin) {
    sheet.slotTotals = sheet.slotTotals.map((t) => (t.personal ? { ...t, amount: 0 } : t));
  }

  return {
    boardName: board.name,
    units,
    phaseColors: Object.fromEntries(phaseRows.map((p) => [p.id, p.color])),
    phases,
    milestones: milestones.map((m) => ({
      id: m.id,
      typeId: m.typeId,
      name: m.name,
      startDate: m.startDate,
      endDate: m.endDate,
      color: m.color,
    })),
    milestoneTypes: milestoneTypes.map((t) => ({ id: t.id, name: t.name })),
    assignableUsers,
    holidays: holidayRows.map((h) => h.date),
    slotRates: isAdmin ? allSlotRates : {},
    slots,
    sheet,
    variances: phaseVariances(phases, sheet.byPhase, actual),
    boardPhases,
    rates: Object.entries(rates).map(([discipline, monthlySalary]) => ({
      discipline: discipline as Discipline,
      monthlySalary,
    })),
    canEditSchedule: access.hasScheduleRole,
    canAddSlot: access.hasScheduleRole || access.disciplines.size > 0,
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
  const [phaseRows, slotRows, rates, units] = await Promise.all([
    prisma.budgetPhase.findMany({ where: { boardId }, orderBy: { order: "asc" } }),
    prisma.labourSlot.findMany({ where: { boardId }, include: { months: true } }),
    rateMap(),
    loadOrgUnits(),
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
    userId: s.userId,
    ownerName: "",
    description: "",
    months: Object.fromEntries(s.months.map((m) => [m.month, Number(m.fte)])),
  }));

  const { byPhase } = buildLabourSheet(phases, slots, rates, units, await loadSlotRates(slots));

  /**
   * 一個預算階段寫一列,不再按「對應到哪一列工作項」去併。
   *
   * 預算現在掛在階段上,所以 DVT1 與 DVT2 各有各的人月與金額,即使它們對到
   * 看板上同一列 —— 對應那一欄只用來比「估的 vs 實際花的」,不再決定數字
   * 存在哪裡。
   */
  for (const phase of byPhase) {
    const phaseId = phase.phaseId;
    await prisma.labourPlan.deleteMany({ where: { phaseId } });

    const cells = phase.byDiscipline.filter((d) => d.personMonths > 0);
    if (cells.length > 0) {
      await prisma.labourPlan.createMany({
        data: cells.map((d) => ({
          phaseId,
          discipline: d.discipline,
          // 人月的欄位是 Decimal(8,2),不收到小數兩位的話寫進去會被截掉
          // 而不是四捨五入。
          personMonths: Math.round(d.personMonths * 100) / 100,
        })),
      });
    }

    if (phase.amount > 0) {
      await prisma.budget.upsert({
        where: { phaseId_category: { phaseId, category: "LABOUR" } },
        create: { phaseId, category: "LABOUR", amount: Math.round(phase.amount), note: "由人力表計算" },
        update: { amount: Math.round(phase.amount), note: "由人力表計算" },
      });
    } else {
      // 一個人月都沒排,人力預算就回到「沒有編列」,而不是留一個 0 在那裡
      // 假裝這個階段核准過 0 元的人力。
      await prisma.budget.deleteMany({ where: { phaseId, category: "LABOUR" } });
    }
  }
}

// ---- 預算階段 ----

export async function upsertBudgetPhase(
  boardId: string,
  input: {
    id?: string;
    name: string;
    startDate: string;
    endDate: string;
    itemId: string | null;
    color?: string;
  }
): Promise<{ error?: string }> {
  const session = await requireScheduleAdmin(boardId);
  const name = input.name.trim();
  if (!name) return { error: "階段名稱不可為空" };
  if (!input.startDate || !input.endDate) return { error: "起訖日期都要填" };
  if (input.endDate < input.startDate) return { error: "結束日不可早於開始日" };

  if (input.id) {
    await prisma.budgetPhase.update({
      where: { id: input.id },
      data: {
        name,
        startDate: input.startDate,
        endDate: input.endDate,
        itemId: input.itemId,
        ...(input.color ? { color: input.color } : {}),
      },
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
        ...(input.color ? { color: input.color } : {}),
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
  const session = await requireScheduleAdmin(boardId);
  const phase = await prisma.budgetPhase.findUnique({ where: { id }, select: { name: true, itemId: true } });
  if (!phase) return { error: "找不到這個階段" };

  // 人月與人力預算都掛在這個階段上,外鍵是 Cascade,刪階段就一起走了 ——
  // 不必再去看板工作項那邊清,那裡本來就沒有它們。
  await prisma.budgetPhase.delete({ where: { id } });
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
    typeId: string;
    name: string;
    startDate: string;
    endDate: string;
    color?: string;
  }
): Promise<{ error?: string }> {
  const session = await requireScheduleAdmin(boardId);
  const name = input.name.trim();
  if (!name) return { error: "里程碑名稱不可為空" };
  if (!input.startDate || !input.endDate) return { error: "起訖日期都要填" };
  if (input.endDate < input.startDate) return { error: "結束日不可早於開始日" };

  // 類型是選的,但選項是這塊看板的 —— 別塊看板的 id 進不來。
  const type = await prisma.milestoneType.findFirst({
    where: { id: input.typeId, boardId },
    select: { id: true },
  });
  if (!type) return { error: "請先選一個里程碑類型" };

  if (input.id) {
    await prisma.planMilestone.update({
      where: { id: input.id },
      data: {
        typeId: type.id,
        name,
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.color ? { color: input.color } : {}),
      },
    });
  } else {
    const count = await prisma.planMilestone.count({ where: { boardId, typeId: type.id } });
    await prisma.planMilestone.create({
      data: {
        boardId,
        typeId: type.id,
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
  const session = await requireScheduleAdmin(boardId);
  const milestone = await prisma.planMilestone.findUnique({ where: { id }, select: { name: true } });
  if (!milestone) return { error: "找不到這個里程碑" };
  await prisma.planMilestone.delete({ where: { id } });
  await logAudit("COST", session.userId, `刪除人力表里程碑「${milestone.name}」`, boardId);
  revalidateBoard(boardId);
  return {};
}

/**
 * 新增一個里程碑類型。名字在同一塊看板裡不重複 —— 兩個同名的類型會排成
 * 兩排,但看起來是同一排的東西被拆開了。
 */
export async function createMilestoneType(
  boardId: string,
  rawName: string
): Promise<{ error?: string }> {
  const session = await requireScheduleAdmin(boardId);
  const name = rawName.trim();
  if (!name) return { error: "類型名稱不可為空" };

  const clash = await prisma.milestoneType.findFirst({ where: { boardId, name } });
  if (clash) return { error: `「${name}」已經有了` };

  const last = await prisma.milestoneType.findFirst({
    where: { boardId },
    orderBy: { order: "desc" },
  });
  await prisma.milestoneType.create({
    data: { boardId, name, order: (last?.order ?? -1) + 1 },
  });

  await logAudit("COST", session.userId, `新增里程碑類型「${name}」`, boardId);
  revalidateBoard(boardId);
  return {};
}

export async function renameMilestoneType(
  boardId: string,
  id: string,
  rawName: string
): Promise<{ error?: string }> {
  const session = await requireScheduleAdmin(boardId);
  const name = rawName.trim();
  if (!name) return { error: "類型名稱不可為空" };

  const type = await prisma.milestoneType.findFirst({ where: { id, boardId } });
  if (!type) return { error: "找不到這個類型" };

  const clash = await prisma.milestoneType.findFirst({
    where: { boardId, name, id: { not: id } },
  });
  if (clash) return { error: `「${name}」已經有了` };

  await prisma.milestoneType.update({ where: { id }, data: { name } });
  await logAudit("COST", session.userId, `里程碑類型「${type.name}」改名為「${name}」`, boardId);
  revalidateBoard(boardId);
  return {};
}

/** 底下還有里程碑就不給刪 —— 刪掉那一排,那些里程碑會連帶不見。 */
export async function deleteMilestoneType(
  boardId: string,
  id: string
): Promise<{ error?: string }> {
  const session = await requireScheduleAdmin(boardId);
  const type = await prisma.milestoneType.findFirst({ where: { id, boardId } });
  if (!type) return { error: "找不到這個類型" };

  const used = await prisma.planMilestone.count({ where: { typeId: id } });
  if (used > 0) {
    return { error: `「${type.name}」底下還有 ${used} 個里程碑,要先改到別的類型或刪掉。` };
  }

  await prisma.milestoneType.delete({ where: { id } });
  await logAudit("COST", session.userId, `刪除里程碑類型「${type.name}」`, boardId);
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
  // 改既有名額:要對「原本的單位」有編輯權才能動它;如果順便把單位換了,
  // 「換去的單位」也要有編輯權才准換——不然隨便一個 DM 都能把別的單位的
  // 名額，改成自己的單位據為己有。
  const existing = input.id
    ? await prisma.labourSlot.findUnique({ where: { id: input.id }, select: { discipline: true } })
    : null;
  if (input.id && !existing) return { error: "找不到這個名額" };
  const session = existing
    ? await requireSlotAdmin(boardId, existing.discipline)
    : await requireSlotAdmin(boardId, input.discipline);
  if (existing && existing.discipline !== input.discipline) {
    await requireSlotAdmin(boardId, input.discipline);
  }
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
  const slot = await prisma.labourSlot.findUnique({ where: { id }, select: { label: true, discipline: true } });
  if (!slot) return { error: "找不到這個名額" };
  const session = await requireSlotAdmin(boardId, slot.discipline);
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
  const slot = await prisma.labourSlot.findUnique({ where: { id: slotId }, select: { discipline: true } });
  if (!slot) return { error: "找不到這個名額" };
  await requireSlotAdmin(boardId, slot.discipline);
  if (!Number.isFinite(fte) || fte < 0) return { error: "投入必須是 0 或正數" };
  // 一個名額就是一個人。要兩個人做,就是兩個名額 —— 讓它超過 1 的話,
  // 「每月總人數」那一列會算出比實際頭數還多的人。
  if (fte > MAX_FTE) return { error: FTE_CAP_MESSAGE };
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
  const slot = await prisma.labourSlot.findUnique({ where: { id: slotId }, select: { discipline: true } });
  if (!slot) return { error: "找不到這個名額" };
  await requireSlotAdmin(boardId, slot.discipline);
  if (!Number.isFinite(fte) || fte < 0) return { error: "投入必須是 0 或正數" };
  if (fte > MAX_FTE) return { error: FTE_CAP_MESSAGE };
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

/**
 * 重新把這塊看板的人力表算回 LabourPlan 與 Budget。
 *
 * 給「改了單位標準月薪」那條路用:價錢變了,已經編出來的金額就得跟著變,
 * 而這些數字唯一的來源就是人力表。
 */
export async function resyncBoardLabour(boardId: string): Promise<void> {
  await syncFromSheet(boardId);
}

/**
 * 這塊看板的預算階段,照排序 —— 給「預算管控」那個下拉用。
 *
 * 只回 id、名稱、對應到哪一列:下拉就只需要這三樣,而整張人力表 view 要一路
 * 抓名額、逐月投入、里程碑跟假日,問一次不便宜。
 */
export async function listBudgetPhases(
  boardId: string
): Promise<{ id: string; name: string; itemId: string | null }[]> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  return prisma.budgetPhase.findMany({
    where: { boardId },
    orderBy: { order: "asc" },
    select: { id: true, name: true, itemId: true },
  });
}
