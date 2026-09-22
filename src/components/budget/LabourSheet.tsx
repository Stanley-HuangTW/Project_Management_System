"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2, Pencil } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { formatMoney } from "@/lib/cost";
import { unitLabel } from "@/lib/orgUnits";
import {
  buildAxis,
  axisSpan,
  packBandRows,
  monthColumnSpans,
  isoWeekNumber,
  MAX_FTE,
  type AxisUnit,
} from "@/lib/labourSheet";
import { PhaseRangeDialog, type RangeDraft } from "./PhaseRangeDialog";
import { MilestoneTypeDialog } from "./MilestoneTypeDialog";
import { SlotDialog, type SlotDraft } from "./SlotDialog";
import { FillRangeDialog } from "./FillRangeDialog";
import {
  getLabourSheetView,
  upsertBudgetPhase,
  deleteBudgetPhase,
  upsertPlanMilestone,
  deletePlanMilestone,
  createMilestoneType,
  renameMilestoneType,
  deleteMilestoneType,
  upsertLabourSlot,
  deleteLabourSlot,
  setLabourSlotMonth,
  fillLabourSlotRange,
  type LabourSheetView,
} from "@/lib/actions/labourSheet";
import { HScrollPane } from "@/components/ui/HScrollPane";
import { LabourExcelButtons } from "./LabourExcelButtons";

const MONTH_WIDTH = 46;
const LABEL_WIDTH = 150;

/** "2026-03-09" → "3/9"。週數說得出是第幾週,說不出那是幾號。 */
function dayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** "2026-03" → "3月",跨年時帶上年份,否則一整排數字讀不出在哪一年。 */
function monthLabel(key: string, previous?: string): string {
  const [year, month] = key.split("-");
  const newYear = !previous || previous.slice(0, 4) !== year;
  return newYear ? `${year.slice(2)}/${Number(month)}` : `${Number(month)}`;
}

/**
 * 人力堆疊表。
 *
 * 一列是一個人力名額(EE1、SW3),每個月填投入多少(1 = 整個月全職),加總
 * 就是人月,乘上該單位的標準月薪就是錢。上面兩排帶是階段與里程碑,用來
 * 對齊「這個月在做什麼」。
 *
 * 表格的階段日期是預算表自己的,跟看板時程分開 —— 預算表是初期評估,跟
 * 實際一定有落差,而下面那張差異表就是拿來看那個落差的。
 */
export function LabourSheet({ boardId }: { boardId: string }) {
  const { notify, confirm } = useDialogs();
  const [view, setView] = useState<LabourSheetView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** 時間軸的刻度。人月的格子永遠是月,這只影響上面那幾條帶畫多細。 */
  const [unit, setUnit] = useState<AxisUnit>("month");

  const reload = useCallback(async () => setView(await getLabourSheetView(boardId)), [boardId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getLabourSheetView(boardId);
        if (!cancelled) setView(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return;
      }
      await reload();
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : failTitle }
      );
    } finally {
      setBusy(false);
    }
  }

  /** 開著的期間對話框:階段或里程碑,新增或編輯。 */
  const [slotDialog, setSlotDialog] = useState<{ id?: string; initial?: SlotDraft } | null>(null);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [fillDialog, setFillDialog] = useState<{ slotId: string; label: string } | null>(null);
  const [rangeDialog, setRangeDialog] = useState<{
    kind: "phase" | "milestone";
    title: string;
    initial?: RangeDraft;
    phaseId?: string;
    itemId?: string | null;
    milestoneId?: string;
    /** 從格子點進來時帶入的開始日。 */
    startAt?: string;
    /** 從某一排里程碑點進來時,那一排的類型。 */
    typeId?: string;
  } | null>(null);

  function addPhase() {
    setRangeDialog({ kind: "phase", title: "新增預算階段" });
  }

  function editPhase(phase: LabourSheetView["phases"][number]) {
    setRangeDialog({
      kind: "phase",
      title: `${phase.name} 的期間`,
      initial: {
        name: phase.name,
        startDate: phase.startDate,
        endDate: phase.endDate,
        color: view?.phaseColors[phase.id] ?? "#fdab3d",
        itemId: phase.itemId,
      },
      phaseId: phase.id,
      itemId: phase.itemId,
    });
  }

  function addMilestone() {
    setRangeDialog({ kind: "milestone", title: "新增里程碑" });
  }

  function editMilestone(milestone: LabourSheetView["milestones"][number]) {
    setRangeDialog({
      kind: "milestone",
      title: `${milestone.name} 的期間`,
      initial: {
        typeId: milestone.typeId,
        name: milestone.name,
        startDate: milestone.startDate,
        endDate: milestone.endDate,
        color: milestone.color,
      },
      milestoneId: milestone.id,
    });
  }

  async function removePhase(id: string, name: string) {
    const ok = await confirm(`刪除階段「${name}」?它推算出來的人力預算會一併收回。`, {
      title: "刪除階段",
      confirmLabel: "刪除",
      danger: true,
    });
    if (ok) await run(() => deleteBudgetPhase(boardId, id), "無法刪除");
  }

  async function removeMilestone(id: string, name: string) {
    const ok = await confirm(`刪除里程碑「${name}」?`, {
      title: "刪除里程碑",
      confirmLabel: "刪除",
      danger: true,
    });
    if (ok) await run(() => deletePlanMilestone(boardId, id), "無法刪除");
  }

  async function removeMilestoneType(type: { id: string; name: string }) {
    const ok = await confirm(`刪除里程碑類型「${type.name}」?`, {
      title: "刪除類型",
      confirmLabel: "刪除",
      danger: true,
    });
    if (ok) await run(() => deleteMilestoneType(boardId, type.id), "無法刪除");
  }

  /** 對話框上那顆刪除:編輯既有的才有,新增的時候沒有東西可刪。 */
  function deleteFromDialog(): (() => void) | undefined {
    const dialog = rangeDialog;
    if (!dialog || !canEdit) return undefined;
    if (dialog.kind === "phase" && dialog.phaseId) {
      const id = dialog.phaseId;
      const name = phaseById.get(id)?.name ?? "";
      return () => removePhase(id, name);
    }
    if (dialog.kind === "milestone" && dialog.milestoneId) {
      const id = dialog.milestoneId;
      const name = milestoneById.get(id)?.name ?? "";
      return () => removeMilestone(id, name);
    }
    return undefined;
  }

  async function submitRange(draft: RangeDraft) {
    const dialog = rangeDialog;
    if (!dialog) return;
    if (dialog.kind === "phase") {
      await run(
        () =>
          upsertBudgetPhase(boardId, {
            id: dialog.phaseId,
            name: draft.name,
            startDate: draft.startDate,
            endDate: draft.endDate,
            itemId: draft.itemId ?? null,
            color: draft.color,
          }),
        dialog.phaseId ? "無法儲存階段" : "無法新增階段"
      );
      return;
    }
    await run(
      () =>
        upsertPlanMilestone(boardId, {
          id: dialog.milestoneId,
          typeId: draft.typeId ?? "",
          name: draft.name,
          startDate: draft.startDate,
          endDate: draft.endDate,
          color: draft.color,
        }),
      dialog.milestoneId ? "無法儲存里程碑" : "無法新增里程碑"
    );
  }

  function addSlot() {
    setSlotDialog({});
  }

  function editSlot(slot: LabourSheetView["slots"][number]) {
    setSlotDialog({
      id: slot.id,
      initial: {
        discipline: slot.discipline,
        label: slot.label,
        func: slot.func,
        userId: slot.userId,
        ownerLabel: slot.userId ? "" : slot.ownerName,
      },
    });
  }

  async function submitSlot(draft: SlotDraft) {
    const dialog = slotDialog;
    if (!dialog) return;
    await run(
      () =>
        upsertLabourSlot(boardId, {
          id: dialog.id,
          discipline: draft.discipline,
          label: draft.label,
          func: draft.func,
          userId: draft.userId,
          ownerLabel: draft.ownerLabel,
          description: "",
        }),
      dialog.id ? "無法儲存名額" : "無法新增名額"
    );
  }

  function fillRow(slotId: string, slotLabel: string) {
    setFillDialog({ slotId, label: slotLabel });
  }

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!view) return null;

  const {
    sheet,
    phases,
    milestones,
    milestoneTypes,
    slots,
    canEdit,
    variances,
    phaseColors,
    units,
    assignableUsers,
    holidays,
    boardPhases,
  } = view;
  const months = sheet.months;
  // 帶畫在自己的刻度上;人月的格子仍然一格一個月。
  const axis = buildAxis(phases, unit);
  const colWidth = unit === "month" ? MONTH_WIDTH : 22;
  const bandWidth = axis.length * colWidth;
  // 月份的格子要跟上面的帶對齊,所以寬度由它在軸上佔幾欄決定 —— 不然
  // 週刻度下帶跟格子會畫在兩條不同長度的軸上。
  const monthSpans = monthColumnSpans(axis, unit, months);
  const monthWidth = (month: string) => {
    const span = monthSpans.find((s) => s.month === month);
    return span ? (span.to - span.from + 1) * colWidth : 0;
  };
  const totalOf = new Map(sheet.slotTotals.map((t) => [t.slotId, t]));
  const rateOf = new Map(view.rates.map((r) => [r.discipline, r.monthlySalary]));
  const milestoneBands = milestones.map((m) => ({
    id: m.id,
    name: m.name,
    startDate: m.startDate,
    endDate: m.endDate,
    color: m.color,
  }));

  /**
   * 點到的是軸上的第幾欄,換成日期。
   *
   * 只有點在空白處才算 —— 點在長條上時 target 是那顆按鈕,那是編輯,不是
   * 新增。月刻度下一欄是一個月,回那個月的一號。
   */
  function dateAtClick(e: React.MouseEvent<HTMLDivElement>): string | null {
    if (e.target !== e.currentTarget) return null;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const index = Math.floor(x / colWidth);
    const key = axis[index];
    if (!key) return null;
    return unit === "month" ? `${key}-01` : key;
  }

  /** 一條帶在軸上的位置。 */
  function band(startDate: string, endDate: string) {
    const span = axisSpan(axis, unit, startDate, endDate);
    if (!span) return null;
    return { left: span.from * colWidth, width: (span.to - span.from + 1) * colWidth };
  }

  // 疊在一起的往下放一列 —— 判斷的是軸上的欄位,不是日期有沒有交集。
  const phaseBands = phases.map((p) => ({
    id: p.id,
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate,
    color: phaseColors[p.id] ?? "#fdab3d",
  }));
  const phaseRowsPacked = packBandRows(phaseBands, axis, unit);
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const milestoneById = new Map(milestones.map((m) => [m.id, m]));
  // 一個類型就是一排。同一排裡真的疊到了才再往下長 —— 不然兩個里程碑會
  // 畫在同一個位置上,誰蓋住誰是看誰先畫。
  const milestoneRowsByType = milestoneTypes.map((type) => ({
    type,
    rows: packBandRows(
      milestoneBands.filter((b) => milestoneById.get(b.id)?.typeId === type.id),
      axis,
      unit
    ),
  }));

  if (phases.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          人力表從階段開始:先排出 EFS、EVT、DVT1 這些階段各自的起訖日,月份欄位就出來了,然後才填每個
          名額每個月投入多少。這裡的日期是預算表自己的初期評估,跟看板時程分開 —— 之後兩邊的落差會在
          下面的差異表列出來。
        </p>
        {canEdit && (
          <button
            type="button"
            onClick={addPhase}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus size={14} /> 新增第一個階段
          </button>
        )}
        {/* 空狀態是提早 return,對話框也得掛在這裡 —— 不然第一個階段永遠
            建不起來:按鈕設了狀態,但沒有東西在畫它。 */}
        <PhaseRangeDialog
          open={rangeDialog !== null}
          onOpenChange={(next) => !next && setRangeDialog(null)}
          title={rangeDialog?.title ?? ""}
          initial={rangeDialog?.initial}
          holidays={view.holidays}
          onSubmit={submitRange}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <LabourExcelButtons boardId={boardId} canEdit={canEdit} onImported={reload} />

      {(sheet.unpricedDisciplines.length > 0 || sheet.monthsOutsideAnyPhase.length > 0) && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            {sheet.unpricedDisciplines.length > 0 && (
              <p>
                {sheet.unpricedDisciplines.map((d) => unitLabel(units, d)).join("、")}
                有排人月,但還沒有標準月薪,那些人月算不出金額。標準月薪在系統設定裡。
              </p>
            )}
            {sheet.monthsOutsideAnyPhase.length > 0 && (
              <p>
                {sheet.monthsOutsideAnyPhase.join("、")} 有排人力,但不在任何階段的期間內,
                所以這些人月進不了階段預算。
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500 dark:text-neutral-400">刻度</span>
        {(
          [
            ["month", "月"],
            ["week", "週"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setUnit(value)}
            className={`rounded-md px-2 py-1 text-xs ${
              unit === value
                ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <HScrollPane
        className="rounded-lg border border-neutral-200 dark:border-neutral-700"
        viewportClassName="max-h-[70vh]"
      >
        <div style={{ minWidth: LABEL_WIDTH + bandWidth + 260 }}>
          {/* 月份表頭。往下捲的時候要跟著走,不然看到一排數字卻不知道是哪個月。 */}
          <div className="sticky top-0 z-30 flex border-b border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/60">
            <div
              style={{ width: LABEL_WIDTH }}
              className="shrink-0 px-2 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400"
            >
              月份
            </div>
            {/* 月份自己一列:塞進週的格子裡會把那一欄撐得跟別欄不一樣寬。 */}
            {months.map((m, i) => (
              <div
                key={m}
                style={{ width: monthWidth(m) }}
                className="shrink-0 border-l border-neutral-300 py-1.5 text-center text-[11px] tabular-nums text-neutral-700 dark:border-neutral-600 dark:text-neutral-200"
              >
                {monthLabel(m, months[i - 1])}
              </div>
            ))}
            <div className="flex-1 px-2 py-1.5 text-right text-xs font-medium text-neutral-500 dark:text-neutral-400">
              人月 / 金額
            </div>
          </div>

          {unit === "week" && (
            <div className="sticky top-[30px] z-30 flex border-b border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/60">
              <div
                style={{ width: LABEL_WIDTH }}
                className="shrink-0 px-2 py-1 text-xs font-medium text-neutral-500 dark:text-neutral-400"
              >
                週次 / 日期
              </div>
              {/* 週數自己不夠定位 —— 看得出是第 12 週,看不出那是三月幾號。 */}
              {axis.map((weekIso) => (
                <div
                  key={weekIso}
                  style={{ width: colWidth }}
                  title={weekIso}
                  className="shrink-0 border-l border-neutral-200 py-0.5 text-center tabular-nums text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
                >
                  <span className="block text-[10px] leading-tight">{isoWeekNumber(weekIso)}</span>
                  <span className="block text-[9px] leading-tight text-neutral-400 dark:text-neutral-500">
                    {dayLabel(weekIso)}
                  </span>
                </div>
              ))}
              <div className="flex-1" />
            </div>
          )}

          {/* 第一部分:時程。階段與里程碑都是「一段期間」,放在一起才看得出彼此的關係。 */}
          <div className="flex items-center border-b-2 border-neutral-300 bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800">
            <div
              style={{ width: LABEL_WIDTH }}
              className="shrink-0 px-2 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-200"
            >
              時程規劃
            </div>
            <div className="flex flex-1 items-center gap-2 px-2 py-1">
              {canEdit ? (
                <>
                  <button type="button" disabled={busy} onClick={addPhase} className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800">
                    + 階段
                  </button>
                  <button type="button" disabled={busy} onClick={addMilestone} className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800">
                    + 里程碑
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setTypeDialogOpen(true)}
                    className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  >
                    里程碑類型
                  </button>
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">
                    點長條可以改名稱與期間
                  </span>
                </>
              ) : (
                <span className="text-xs text-neutral-400 dark:text-neutral-500">階段與里程碑</span>
              )}
            </div>
          </div>

          {/* 階段帶。重疊的往下疊,所以這裡是一到多列。 */}
          {phaseRowsPacked.map((row, rowIndex) => (
            <div
              key={`phase-row-${rowIndex}`}
              className="flex items-center border-b border-neutral-200 dark:border-neutral-700"
            >
              <div
                style={{ width: LABEL_WIDTH }}
                className="shrink-0 px-2 py-1 text-xs font-medium text-neutral-600 dark:text-neutral-300"
              >
                {rowIndex === 0 ? "預算階段" : ""}
              </div>
              <div
                className={`relative shrink-0 ${canEdit ? "cursor-copy" : ""}`}
                style={{ width: bandWidth, height: 26 }}
                title={canEdit ? "點空白處可以從那個時間開始新增階段" : undefined}
                onClick={(e) => {
                  if (!canEdit || busy) return;
                  const date = dateAtClick(e);
                  if (date) setRangeDialog({ kind: "phase", title: "新增預算階段", startAt: date });
                }}
              >
                {row.map((entry) => {
                  const box = band(entry.startDate, entry.endDate);
                  const phase = phaseById.get(entry.id);
                  if (!box || !phase) return null;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={!canEdit || busy}
                      onClick={() => editPhase(phase)}
                      title={`${entry.name}:${entry.startDate} ~ ${entry.endDate}${canEdit ? "(點選修改)" : ""}`}
                      className="absolute top-1 flex h-5 items-center justify-center overflow-hidden rounded-sm px-1 text-[10px] font-medium text-white hover:ring-1 hover:ring-neutral-500 disabled:cursor-default"
                      style={{
                        left: box.left + 1,
                        width: box.width - 2,
                        backgroundColor: entry.color,
                      }}
                    >
                      {entry.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* 里程碑帶。一個類型一排,同一排裡疊到才往下長。 */}
          {milestoneRowsByType.map(({ type, rows }) =>
            (rows.length > 0 ? rows : [[]]).map((row, rowIndex) => (
              <div
                key={`${type.id}-${rowIndex}`}
                className="flex items-center border-b border-neutral-200 dark:border-neutral-700"
              >
                <div
                  style={{ width: LABEL_WIDTH }}
                  title={type.name}
                  className="shrink-0 truncate px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400"
                >
                  {rowIndex === 0 ? type.name : ""}
                </div>
                <div
                  className={`relative shrink-0 ${canEdit ? "cursor-copy" : ""}`}
                  style={{ width: bandWidth, height: 24 }}
                  title={canEdit ? `點空白處可以在「${type.name}」新增里程碑` : undefined}
                  onClick={(e) => {
                    if (!canEdit || busy) return;
                    const date = dateAtClick(e);
                    if (date) {
                      setRangeDialog({
                        kind: "milestone",
                        title: `新增里程碑(${type.name})`,
                        startAt: date,
                        typeId: type.id,
                      });
                    }
                  }}
                >
                  {row.map((entry) => {
                    const box = band(entry.startDate, entry.endDate);
                    const milestone = milestoneById.get(entry.id);
                    if (!box || !milestone) return null;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        disabled={!canEdit || busy}
                        onClick={() => editMilestone(milestone)}
                        title={`${type.name}・${entry.name}:${entry.startDate} ~ ${entry.endDate}${canEdit ? "(點選修改)" : ""}`}
                        className="absolute top-1 flex h-4 items-center justify-center overflow-hidden rounded-sm px-1 text-[9px] font-medium text-white hover:ring-1 hover:ring-neutral-500 disabled:cursor-default"
                        style={{
                          left: box.left + 1,
                          width: box.width - 2,
                          backgroundColor: entry.color,
                        }}
                      >
                        {entry.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {/* 第二部分:人力設定。跟上面的時程帶分開,因為兩邊填的是不同的東西。 */}
          <div className="flex items-center border-b-2 border-t-2 border-neutral-300 bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800">
            <div
              style={{ width: LABEL_WIDTH }}
              className="shrink-0 px-2 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-200"
            >
              人力設定
            </div>
            <div className="flex flex-1 items-center gap-2 px-2 py-1">
              {canEdit && (
                <button type="button" disabled={busy} onClick={addSlot} className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800">
                  + 人力名額
                </button>
              )}
              <span className="text-xs text-neutral-400 dark:text-neutral-500">
                每個名額逐月填投入,1 = 整個月全職
              </span>
            </div>
          </div>

          {/* 人力名額,照單位分段 */}
          {units.map(({ code: discipline }) => {
            const mine = slots.filter((s) => s.discipline === discipline);
            if (mine.length === 0) return null;
            const total = sheet.byDiscipline.find((d) => d.discipline === discipline)!;
            return (
              <div key={discipline}>
                <div className="flex items-center border-b border-t border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/60">
                  <div
                    style={{ width: LABEL_WIDTH }}
                    className="shrink-0 px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-200"
                  >
                    {unitLabel(units, discipline)}
                  </div>
                  {months.map((m) => (
                    <div
                      key={m}
                      style={{ width: monthWidth(m) }}
                      className="shrink-0 border-l border-neutral-200 py-1 text-center text-[10px] tabular-nums text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
                    >
                      {total.byMonth[m] ? total.byMonth[m] : ""}
                    </div>
                  ))}
                  <div className="flex-1 px-2 py-1 text-right text-xs tabular-nums text-neutral-700 dark:text-neutral-200">
                    {total.personMonths} 人月
                    <span className="ml-2 text-neutral-400 dark:text-neutral-500">
                      {rateOf.get(discipline) ? formatMoney(total.amount) : "未定價"}
                    </span>
                  </div>
                </div>

                {mine.map((slot) => {
                  const rowTotal = totalOf.get(slot.id);
                  return (
                    <div
                      key={slot.id}
                      className="group flex items-center border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40"
                    >
                      {/* 固定寬度跟名額欄一樣寬,浮動按鈕鎖在這個框裡面
                          (right 定位)——不管名字多長都不會跨到月份欄,
                          第一個月格子永遠點得到。 */}
                      <div className="relative shrink-0" style={{ width: LABEL_WIDTH }}>
                        {/* 整格可以點 —— 指派誰、屬於哪個單位都在同一個對話框裡改。 */}
                        <button
                          type="button"
                          disabled={!canEdit || busy}
                          onClick={() => editSlot(slot)}
                          style={{ width: LABEL_WIDTH }}
                          title={
                            canEdit
                              ? `${slot.description || slot.label}(點選設定單位與人員)`
                              : slot.description
                          }
                          className="flex items-center gap-1 px-2 py-1 text-left hover:bg-neutral-100 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-neutral-800"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs text-neutral-800 dark:text-neutral-100">
                            {slot.label}
                            {slot.func && (
                              <span className="ml-1 text-neutral-400 dark:text-neutral-500">{slot.func}</span>
                            )}
                          </span>
                          <span
                            className={`shrink-0 truncate text-[10px] ${
                              slot.userId
                                ? "text-neutral-500 dark:text-neutral-300"
                                : "rounded bg-neutral-100 px-1 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
                            }`}
                          >
                            {slot.ownerName}
                          </span>
                        </button>

                        {canEdit && (
                          <span
                            className="absolute z-10 flex items-center gap-1 opacity-0 transition group-hover:opacity-100"
                            style={{ right: 2, top: "50%", transform: "translateY(-50%)" }}
                          >
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => fillRow(slot.id, slot.label)}
                              title="整列填滿:從某月到某月"
                              className="rounded bg-white p-0.5 text-neutral-400 shadow-sm hover:text-blue-600 disabled:opacity-50 dark:bg-neutral-900"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                const ok = await confirm(`刪除名額「${slot.label}」?`, {
                                  title: "刪除名額",
                                  confirmLabel: "刪除",
                                  danger: true,
                                });
                                if (ok) await run(() => deleteLabourSlot(boardId, slot.id), "無法刪除");
                              }}
                              title="刪除這個名額"
                              className="rounded bg-white p-0.5 text-neutral-400 shadow-sm hover:text-red-600 disabled:opacity-50 dark:bg-neutral-900"
                            >
                              <Trash2 size={11} />
                            </button>
                          </span>
                        )}
                      </div>

                      {months.map((m) => (
                        <FteCell
                          key={m}
                          value={slot.months[m] ?? 0}
                          disabled={!canEdit || busy}
                          width={monthWidth(m)}
                          onCommit={(next) => run(() => setLabourSlotMonth(boardId, slot.id, m, next), "無法儲存")}
                        />
                      ))}

                      <div className="flex flex-1 items-center justify-end gap-2 px-2">
                        <span className="text-xs tabular-nums text-neutral-700 dark:text-neutral-200">
                          {rowTotal?.personMonths ?? 0}
                        </span>
                        <span className="w-24 text-right text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                          {rowTotal?.amount ? formatMoney(rowTotal.amount) : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* 每個月總人數 */}
          <div className="flex items-center border-t-2 border-neutral-300 bg-neutral-50 font-medium dark:border-neutral-600 dark:bg-neutral-800/60">
            <div
              style={{ width: LABEL_WIDTH }}
              className="shrink-0 px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-200"
            >
              每月總人數
            </div>
            {months.map((m) => (
              <div
                key={m}
                style={{ width: monthWidth(m) }}
                className="shrink-0 border-l border-neutral-200 py-1.5 text-center text-[11px] tabular-nums text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
              >
                {sheet.headcountByMonth[m] ?? ""}
              </div>
            ))}
            <div className="flex-1 px-2 py-1.5 text-right text-xs tabular-nums text-neutral-800 dark:text-neutral-100">
              {sheet.totalPersonMonths} 人月・{formatMoney(sheet.totalAmount)}
            </div>
          </div>
        </div>
      </HScrollPane>

      {/* 單位彙總,就是那張 Excel 右下角的 Summary */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
          <p className="mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-200">各單位人月預算</p>
          <table className="w-full text-sm">
            <tbody>
              {sheet.byDiscipline
                .filter((d) => d.personMonths > 0)
                .map((d) => (
                  <tr key={d.discipline} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1 text-neutral-700 dark:text-neutral-200">
                      {unitLabel(units, d.discipline)}
                    </td>
                    <td className="py-1 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                      {d.personMonths} 人月
                    </td>
                    <td className="py-1 text-right tabular-nums text-neutral-800 dark:text-neutral-100">
                      {rateOf.get(d.discipline) ? formatMoney(d.amount) : "未定價"}
                    </td>
                  </tr>
                ))}
              <tr className="border-t-2 border-neutral-300 font-medium dark:border-neutral-600">
                <td className="py-1.5 text-neutral-800 dark:text-neutral-100">合計</td>
                <td className="py-1.5 text-right tabular-nums">{sheet.totalPersonMonths} 人月</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(sheet.totalAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
          <p className="mb-1 text-xs font-medium text-neutral-700 dark:text-neutral-200">
            當初排的 vs 現在要的
          </p>
          <p className="mb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            金額是「人數不變、時間拉長」下的推算:工期多幾成,人力成本就多幾成。沒對應到看板階段列的,
            不假裝比得出來。
          </p>
          {variances.length === 0 ? (
            <p className="py-3 text-center text-xs text-neutral-400 dark:text-neutral-500">還沒有階段</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-neutral-500 dark:text-neutral-400">
                  <th className="pb-1 font-normal">階段</th>
                  <th className="pb-1 text-right font-normal">排定</th>
                  <th className="pb-1 text-right font-normal">現在</th>
                  <th className="pb-1 text-right font-normal">差異</th>
                  <th className="pb-1 text-right font-normal">人力差額</th>
                </tr>
              </thead>
              <tbody>
                {variances.map((v) => (
                  <tr key={v.phaseId} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1 text-neutral-700 dark:text-neutral-200">{v.phaseName}</td>
                    <td className="py-1 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                      {v.plannedDays} 天
                    </td>
                    <td className="py-1 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                      {v.actualDays === null ? "—" : `${v.actualDays} 天`}
                    </td>
                    <td
                      className={`py-1 text-right tabular-nums ${
                        v.daysVariance === null
                          ? "text-neutral-400 dark:text-neutral-500"
                          : v.daysVariance > 0
                            ? "text-red-600"
                            : v.daysVariance < 0
                              ? "text-green-600"
                              : "text-neutral-500 dark:text-neutral-400"
                      }`}
                    >
                      {v.daysVariance === null
                        ? "未對應"
                        : v.daysVariance === 0
                          ? "準時"
                          : `${v.daysVariance > 0 ? "+" : ""}${v.daysVariance} 天`}
                    </td>
                    <td
                      className={`py-1 text-right tabular-nums ${
                        v.amountVariance === null
                          ? "text-neutral-400 dark:text-neutral-500"
                          : v.amountVariance > 0
                            ? "text-red-600"
                            : v.amountVariance < 0
                              ? "text-green-600"
                              : "text-neutral-500 dark:text-neutral-400"
                      }`}
                    >
                      {v.amountVariance === null || v.amountVariance === 0
                        ? "—"
                        : `${v.amountVariance > 0 ? "+" : ""}${formatMoney(v.amountVariance)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <FillRangeDialog
        open={fillDialog !== null}
        onOpenChange={(next) => !next && setFillDialog(null)}
        slotLabel={fillDialog?.label ?? ""}
        months={months}
        onSubmit={(from, to, fte) => {
          const slotId = fillDialog?.slotId;
          if (slotId) run(() => fillLabourSlotRange(boardId, slotId, from, to, fte), "無法填入");
        }}
      />

      <SlotDialog
        open={slotDialog !== null}
        onOpenChange={(next) => !next && setSlotDialog(null)}
        units={units}
        users={assignableUsers}
        initial={slotDialog?.initial}
        onSubmit={submitSlot}
      />

      <PhaseRangeDialog
        open={rangeDialog !== null}
        onOpenChange={(next) => !next && setRangeDialog(null)}
        title={rangeDialog?.title ?? ""}
        initial={
          rangeDialog?.initial ??
          (rangeDialog?.startAt
            ? {
                typeId: rangeDialog.typeId,
                name: "",
                startDate: rangeDialog.startAt,
                endDate: "",
                color: "#fdab3d",
              }
            : undefined)
        }
        holidays={holidays}
        boardPhases={rangeDialog?.kind === "phase" ? boardPhases : undefined}
        types={rangeDialog?.kind === "milestone" ? milestoneTypes : undefined}
        onManageTypes={
          rangeDialog?.kind === "milestone"
            ? () => {
                setRangeDialog(null);
                setTypeDialogOpen(true);
              }
            : undefined
        }
        onDelete={deleteFromDialog()}
        onSubmit={submitRange}
      />

      <MilestoneTypeDialog
        open={typeDialogOpen}
        onOpenChange={setTypeDialogOpen}
        types={milestoneTypes}
        busy={busy}
        onCreate={(name) => run(() => createMilestoneType(boardId, name), "無法新增類型")}
        onRename={(id, name) => run(() => renameMilestoneType(boardId, id, name), "無法改名")}
        onDelete={removeMilestoneType}
      />

      {canEdit && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          點階段帶可以改期間,點格子填投入,滑到一列名額旁邊可以整列填滿或刪除。人月加總會自動寫回各階段的
          人力預算,所以「各類別」的人力那一列不用手填。
        </p>
      )}
      {!canEdit && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          你沒有編輯這個看板預算的權限,以上為唯讀。
        </p>
      )}
    </div>
  );
}

/**
 * 一個月的投入格。
 *
 * 用真的 input 而不是一顆按鈕:整排空格子看起來就是一片空白,沒人知道那裡
 * 可以打字,而按鈕還得再開一個對話框才填得了一個數字。離開欄位才存 ——
 * 打 0.5 的過程會先經過 0,那是個會被寫進去的錯值。
 */
function FteCell({
  value,
  disabled,
  width,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  width: number;
  onCommit: (next: number) => void;
}) {
  const [text, setText] = useState(value > 0 ? String(value) : "");
  const [prev, setPrev] = useState(value);
  // 外面重新載入之後把格子同步過來,但不要蓋掉正在打的字。
  if (value !== prev) {
    setPrev(value);
    setText(value > 0 ? String(value) : "");
  }

  function commit() {
    const next = text.trim() === "" ? 0 : Number(text);
    // 超過上限就退回原值,不要送出去等伺服器打回來 —— 那一趟往返之間,
    // 格子上顯示的是一個不會被接受的數字。
    if (!Number.isFinite(next) || next < 0 || next > MAX_FTE) {
      setText(value > 0 ? String(value) : "");
      return;
    }
    if (next !== value) onCommit(next);
  }

  return (
    <input
      value={text}
      disabled={disabled}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      title={`投入多少?${MAX_FTE} = 整個月全職,0.5 = 半個月。一個名額最多 ${MAX_FTE},需要兩個人請開兩個名額。`}
      className={`shrink-0 border-l border-neutral-100 py-1 text-center text-[11px] tabular-nums outline-none focus:bg-white focus:ring-1 focus:ring-blue-400 disabled:cursor-default dark:border-neutral-800 dark:focus:bg-neutral-900 ${
        value > 0
          ? "bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200"
          : "bg-transparent text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
      style={{ width }}
    />
  );
}
