import { prisma } from "@/lib/prisma";
import type { ApplyResult } from "@/lib/timeTemplates";
import { logActivityTime } from "@/lib/actions/activityTime";
import { logTime } from "@/lib/actions/timeEntry";

/** 要建立的一筆工時,不含日期。 */
export type EntrySpec =
  | { kind: "project"; itemId: string; startMinute: number | null; hours: number; note: string }
  | {
      kind: "activity";
      categoryId: string;
      boardId: string | null;
      riskEntryId: string | null;
      startMinute: number | null;
      hours: number;
      note: string;
    };

/**
 * 在某一天建立一筆工時。同一天已經有一樣的(同工作項/類別、專案、開始時間、時數)就不重複建立。
 * 走一般登記的 logTime / logActivityTime,所以審核、24 小時上限、免審核等規則都一樣。
 *
 * 這支帶 userId,所以放在不是 "use server" 的檔案——不然會變成任何人都能呼叫的 server action。
 */
export async function createFromSpec(
  userId: string,
  date: string,
  spec: EntrySpec,
  seriesId?: string
): Promise<"created" | "exists" | string> {
  if (spec.kind === "project") {
    const dup = await prisma.timeEntry.findFirst({
      where: { userId, date, itemId: spec.itemId, startMinute: spec.startMinute, hours: spec.hours, status: { not: "REJECTED" } },
      select: { id: true },
    });
    if (dup) return "exists";
    try {
      const { error } = await logTime(spec.itemId, date, spec.hours, spec.note, undefined, spec.startMinute, seriesId);
      return error ?? "created";
    } catch (err) {
      return err instanceof Error ? err.message : "建立失敗";
    }
  }
  const dup = await prisma.activityTimeEntry.findFirst({
    where: {
      userId,
      date,
      categoryId: spec.categoryId,
      boardId: spec.boardId,
      startMinute: spec.startMinute,
      hours: spec.hours,
      status: { not: "REJECTED" },
    },
    select: { id: true },
  });
  if (dup) return "exists";
  const { error } = await logActivityTime({
    date,
    hours: spec.hours,
    categoryId: spec.categoryId,
    note: spec.note,
    riskEntryId: spec.riskEntryId,
    boardId: spec.boardId,
    startMinute: spec.startMinute,
    seriesId: seriesId ?? null,
  });
  return error ?? "created";
}

export async function applySpecs(
  userId: string,
  items: { date: string; label: string; spec: EntrySpec; seriesId?: string }[]
): Promise<ApplyResult> {
  const result: ApplyResult = { created: 0, existing: 0, failed: [] };
  // 依序建立:前面建好的會算進當天 24 小時上限。
  for (const { date, label, spec, seriesId } of items) {
    const outcome = await createFromSpec(userId, date, spec, seriesId);
    if (outcome === "created") result.created++;
    else if (outcome === "exists") result.existing++;
    else result.failed.push(`${date} ${label}:${outcome}`);
  }
  return result;
}
