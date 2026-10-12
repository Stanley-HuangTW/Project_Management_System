"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { getLabourSheetView, resyncBoardLabour, requireScheduleAdmin } from "@/lib/actions/labourSheet";
import { buildLabourWorkbook, parseLabourWorkbook } from "@/lib/export/labourWorkbook";
import { LABOUR_APPS_SCRIPT } from "@/lib/export/labourAppsScript";
import { loadOrgUnits } from "@/lib/orgUnitsServer";

/**
 * 人力表的 Excel 匯出/匯入。
 *
 * 跟 labourSheet.ts 分開:那支是畫面在用的一格一格編輯,這支是整張表換掉。
 * 兩件事的失敗方式完全不同 —— 一格填錯就是一格,匯入填錯是一整張表。
 */

/** 20MB,跟憑證上傳同一個上限。 */
const MAX_UPLOAD = 20 * 1024 * 1024;

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

export type LabourExportResult =
  | { error: string }
  | { xlsxFilename: string; xlsxBase64: string; gsFilename: string; gsContent: string };

export async function exportLabourWorkbook(boardId: string): Promise<LabourExportResult> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const view = await getLabourSheetView(boardId);
  if (!view) return { error: "找不到這個看板" };
  if (view.sheet.months.length === 0) {
    return { error: "還沒有預算階段,人力表沒有月份可以匯出。請先在人力表上新增階段。" };
  }

  const buffer = await buildLabourWorkbook({
    boardName: view.boardName,
    months: view.sheet.months,
    phases: view.phases,
    slots: view.slots,
    units: view.units,
    rates: view.rates,
    slotRates: view.slotRates,
    hasPersonalSlots: view.sheet.slotTotals.some((t) => t.personal),
    milestoneTypes: view.milestoneTypes,
    milestones: view.milestones,
  });

  await logAudit("COST", session.userId, `匯出「${view.boardName}」的人力表 Excel`);
  const baseName = safeFilename(view.boardName);
  return {
    xlsxFilename: `${baseName}-人力表.xlsx`,
    xlsxBase64: buffer.toString("base64"),
    gsFilename: `${baseName}-人力表-AppsScript.gs`,
    gsContent: LABOUR_APPS_SCRIPT,
  };
}

export type LabourImportResult = {
  created: number;
  updated: number;
  /** 程式裡有、但這份 Excel 裡沒有的名額。刻意不刪 —— 只是說出來。 */
  untouched: string[];
  warnings: string[];
  error?: string;
};

/**
 * 收回一份改過的人力表。
 *
 * 只新增與更新,不刪:Excel 裡少一列的原因可能是有人為了看得清楚把它隱藏
 * 或剪掉了,而刪掉一個名額會連它十幾個月的投入一起帶走。少掉的名額會列在
 * untouched 裡講清楚,要刪請在程式裡刪 —— 那裡刪得掉,而且看得到刪的是誰。
 */
export async function importLabourWorkbook(
  boardId: string,
  base64: string
): Promise<LabourImportResult> {
  const session = await requireScheduleAdmin(boardId);

  const empty = { created: 0, updated: 0, untouched: [], warnings: [] };

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { name: true },
  });
  if (!board) return { ...empty, error: "找不到這個看板" };

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) return { ...empty, error: "檔案是空的" };
  if (buffer.length > MAX_UPLOAD) return { ...empty, error: "檔案超過 20MB" };

  let parsed;
  try {
    parsed = await parseLabourWorkbook(buffer);
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "讀不懂這個檔案" };
  }

  const [existing, units] = await Promise.all([
    prisma.labourSlot.findMany({
      where: { boardId },
      select: { id: true, label: true, order: true },
      orderBy: { order: "asc" },
    }),
    loadOrgUnits(),
  ]);
  const byId = new Map(existing.map((s) => [s.id, s]));
  const unitCodes = new Set(units.map((u) => u.code));

  const warnings = [...parsed.warnings];
  let created = 0;
  let updated = 0;
  const touched = new Set<string>();
  let nextOrder = existing.reduce((max, s) => Math.max(max, s.order), 0) + 1;

  for (const slot of parsed.slots) {
    // 單位要是設定裡真的有的那幾個 —— 打錯字建出一個 "EE " 單位,之後所有
    // 按單位加總的地方都會多一列對不起來的數字。
    if (!unitCodes.has(slot.discipline)) {
      warnings.push(
        `名額「${slot.label}」的單位「${slot.discipline}」不在組織單位設定裡,整列略過。`
      );
      continue;
    }

    const months = Object.entries(slot.fte).map(([month, fte]) => ({ month, fte }));
    const target = slot.id !== "" ? byId.get(slot.id) : undefined;

    if (slot.id !== "" && !target) {
      warnings.push(`名額「${slot.label}」的 ID 在這塊看板上找不到,當成新名額新增。`);
    }

    if (target) {
      touched.add(target.id);
      await prisma.$transaction([
        prisma.labourSlot.update({
          where: { id: target.id },
          data: {
            label: slot.label,
            discipline: slot.discipline,
            func: slot.func,
            ownerLabel: slot.ownerLabel,
          },
        }),
        // 整列換掉而不是逐月比對:Excel 裡把一格清空就是「這個月沒有」,
        // 逐月 upsert 的話清空的那幾格會留著舊數字。
        prisma.labourSlotMonth.deleteMany({ where: { slotId: target.id } }),
        ...(months.length > 0
          ? [
              prisma.labourSlotMonth.createMany({
                data: months.map((m) => ({ slotId: target.id, ...m })),
              }),
            ]
          : []),
      ]);
      updated++;
    } else {
      const fresh = await prisma.labourSlot.create({
        data: {
          boardId,
          label: slot.label,
          discipline: slot.discipline,
          func: slot.func,
          ownerLabel: slot.ownerLabel,
          order: nextOrder++,
          createdById: session.userId,
        },
        select: { id: true },
      });
      if (months.length > 0) {
        await prisma.labourSlotMonth.createMany({
          data: months.map((m) => ({ slotId: fresh.id, ...m })),
        });
      }
      created++;
    }
  }

  // 人月變了,階段的人力預算就得跟著重算 —— 不然人力表跟預算管控上的
  // 數字會從這一刻起悄悄對不起來。
  await resyncBoardLabour(boardId);

  const untouched = existing.filter((s) => !touched.has(s.id)).map((s) => s.label);

  await logAudit(
    "COST",
    session.userId,
    `匯入「${board.name}」的人力表 Excel:新增 ${created}、更新 ${updated}、未提及 ${untouched.length}`
  );
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");

  return { created, updated, untouched, warnings };
}
