"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2, Pencil } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { formatMoney } from "@/lib/cost";
import { DISCIPLINES, DISCIPLINE_LABELS } from "@/lib/labourPlan";
import { buildAxis, axisSpan, packBandRows, type AxisUnit } from "@/lib/labourSheet";
import { PhaseRangeDialog, type RangeDraft } from "./PhaseRangeDialog";
import {
  getLabourSheetView,
  upsertBudgetPhase,
  deleteBudgetPhase,
  upsertPlanMilestone,
  deletePlanMilestone,
  upsertLabourSlot,
  deleteLabourSlot,
  setLabourSlotMonth,
  fillLabourSlotRange,
  type LabourSheetView,
} from "@/lib/actions/labourSheet";

const MONTH_WIDTH = 46;
const LABEL_WIDTH = 150;

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
  const { notify, confirm, prompt } = useDialogs();
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
  const [rangeDialog, setRangeDialog] = useState<{
    kind: "phase" | "milestone";
    title: string;
    initial?: RangeDraft;
    phaseId?: string;
    itemId?: string | null;
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
      },
      phaseId: phase.id,
      itemId: phase.itemId,
    });
  }

  function addMilestone() {
    setRangeDialog({ kind: "milestone", title: "新增里程碑" });
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
            itemId: dialog.itemId ?? null,
            color: draft.color,
          }),
        dialog.phaseId ? "無法儲存階段" : "無法新增階段"
      );
      return;
    }
    await run(
      () =>
        upsertPlanMilestone(boardId, {
          track: draft.track ?? "里程碑",
          name: draft.name,
          startDate: draft.startDate,
          endDate: draft.endDate,
          color: draft.color,
        }),
      "無法新增里程碑"
    );
  }

  async function addSlot() {
    const label = await prompt("名額代號?例如 EE1、SW3、ME2", { title: "新增人力名額" });
    if (label === null || !label.trim()) return;
    const guess = DISCIPLINES.find((d) => label.trim().toUpperCase().startsWith(d)) ?? "OTHER";
    await run(
      () =>
        upsertLabourSlot(boardId, {
          discipline: guess,
          label: label.trim(),
          func: "",
          userId: null,
          ownerLabel: "TBH",
          description: "",
        }),
      "無法新增名額"
    );
  }

  async function fillRow(slotId: string, slotLabel: string) {
    const from = await prompt(`${slotLabel} 從哪個月開始?格式 2026-03`, { title: "整列填滿" });
    if (from === null || !from.trim()) return;
    const to = await prompt(`${slotLabel} 到哪個月結束?格式 2026-08`, { title: "整列填滿" });
    if (to === null || !to.trim()) return;
    const answer = await prompt("每個月投入多少?1 = 全職", {
      title: "整列填滿",
      defaultValue: "1",
      numeric: true,
    });
    if (answer === null || answer.trim() === "") return;
    const fte = Number(answer);
    if (!Number.isFinite(fte)) return;
    await run(
      () => fillLabourSlotRange(boardId, slotId, from.trim(), to.trim(), fte),
      "無法填入"
    );
  }

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!view) return null;

  const { sheet, phases, milestones, slots, canEdit, variances, phaseColors } = view;
  const months = sheet.months;
  // 帶畫在自己的刻度上;人月的格子仍然一格一個月。
  const axis = buildAxis(phases, unit);
  const colWidth = unit === "month" ? MONTH_WIDTH : 16;
  const bandWidth = axis.length * colWidth;
  const totalOf = new Map(sheet.slotTotals.map((t) => [t.slotId, t]));
  const rateOf = new Map(view.rates.map((r) => [r.discipline, r.monthlySalary]));
  const tracks = [...new Set(milestones.map((m) => m.track))];
  const timelineWidth = months.length * MONTH_WIDTH;

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
          withTrack={rangeDialog?.kind === "milestone"}
          onSubmit={submitRange}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(sheet.unpricedDisciplines.length > 0 || sheet.monthsOutsideAnyPhase.length > 0) && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            {sheet.unpricedDisciplines.length > 0 && (
              <p>
                {sheet.unpricedDisciplines.map((d) => DISCIPLINE_LABELS[d]).join("、")}
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

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={addPhase}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            + 階段
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={addMilestone}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            + 里程碑
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={addSlot}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            + 人力名額
          </button>

          <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
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
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
        <div style={{ minWidth: LABEL_WIDTH + timelineWidth + 260 }}>
          {/* 月份表頭 */}
          <div className="flex border-b border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/60">
            <div
              style={{ width: LABEL_WIDTH }}
              className="shrink-0 px-2 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400"
            >
              月份
            </div>
            {months.map((m, i) => (
              <div
                key={m}
                style={{ width: MONTH_WIDTH }}
                className="shrink-0 border-l border-neutral-200 py-1.5 text-center text-[11px] tabular-nums text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
              >
                {monthLabel(m, months[i - 1])}
              </div>
            ))}
            <div className="flex-1 px-2 py-1.5 text-right text-xs font-medium text-neutral-500 dark:text-neutral-400">
              人月 / 金額
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
              <div className="relative shrink-0" style={{ width: bandWidth, height: 26 }}>
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
              <div className="flex flex-1 items-center justify-end gap-1 px-2">
                {canEdit &&
                  row.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await confirm(
                          `刪除階段「${entry.name}」?它推算出來的人力預算會一併收回。`,
                          { title: "刪除階段", confirmLabel: "刪除", danger: true }
                        );
                        if (ok) await run(() => deleteBudgetPhase(boardId, entry.id), "無法刪除");
                      }}
                      title={`刪除 ${entry.name}`}
                      className="rounded p-0.5 text-neutral-300 hover:text-red-600 disabled:opacity-50 dark:text-neutral-600"
                    >
                      <Trash2 size={11} />
                    </button>
                  ))}
              </div>
            </div>
          ))}

          {/* 里程碑帶,一個 track 一列 */}
          {tracks.map((track) => (
            <div key={track} className="flex items-center border-b border-neutral-200 dark:border-neutral-700">
              <div
                style={{ width: LABEL_WIDTH }}
                className="shrink-0 truncate px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400"
              >
                {track}
              </div>
              <div className="relative shrink-0" style={{ width: bandWidth, height: 24 }}>
                {milestones
                  .filter((m) => m.track === track)
                  .map((milestone) => {
                    const box = band(milestone.startDate, milestone.endDate);
                    if (!box) return null;
                    return (
                      <button
                        key={milestone.id}
                        type="button"
                        disabled={!canEdit || busy}
                        onClick={async () => {
                          const ok = await confirm(
                            `刪除里程碑「${milestone.name}」?`,
                            { title: "刪除里程碑", confirmLabel: "刪除", danger: true }
                          );
                          if (ok) await run(() => deletePlanMilestone(boardId, milestone.id), "無法刪除");
                        }}
                        title={`${milestone.name}:${milestone.startDate} ~ ${milestone.endDate}${canEdit ? "(點選刪除)" : ""}`}
                        className="absolute top-1 flex h-4 items-center justify-center overflow-hidden rounded-sm px-1 text-[9px] font-medium text-white hover:ring-1 hover:ring-neutral-500 disabled:cursor-default"
                        style={{
                          left: box.left + 1,
                          width: box.width - 2,
                          backgroundColor: milestone.color,
                        }}
                      >
                        {milestone.name}
                      </button>
                    );
                  })}
              </div>
              <div className="flex-1" />
            </div>
          ))}

          {/* 人力名額,照單位分段 */}
          {DISCIPLINES.map((discipline) => {
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
                    {DISCIPLINE_LABELS[discipline]}
                  </div>
                  {months.map((m) => (
                    <div
                      key={m}
                      style={{ width: MONTH_WIDTH }}
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
                      <div
                        style={{ width: LABEL_WIDTH }}
                        className="flex shrink-0 items-center gap-1 px-2 py-1"
                        title={slot.description}
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-neutral-800 dark:text-neutral-100">
                          {slot.label}
                          {slot.func && (
                            <span className="ml-1 text-neutral-400 dark:text-neutral-500">{slot.func}</span>
                          )}
                        </span>
                        <span className="shrink-0 truncate text-[10px] text-neutral-400 dark:text-neutral-500">
                          {slot.ownerName}
                        </span>
                      </div>

                      {months.map((m) => (
                        <FteCell
                          key={m}
                          value={slot.months[m] ?? 0}
                          disabled={!canEdit || busy}
                          width={MONTH_WIDTH}
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
                        {canEdit && (
                          <span className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => fillRow(slot.id, slot.label)}
                              title="整列填滿:從某月到某月"
                              className="rounded p-0.5 text-neutral-400 hover:text-blue-600 disabled:opacity-50"
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
                              className="rounded p-0.5 text-neutral-400 hover:text-red-600 disabled:opacity-50"
                            >
                              <Trash2 size={11} />
                            </button>
                          </span>
                        )}
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
                style={{ width: MONTH_WIDTH }}
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
      </div>

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
                      {DISCIPLINE_LABELS[d.discipline]}
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

      <PhaseRangeDialog
        open={rangeDialog !== null}
        onOpenChange={(next) => !next && setRangeDialog(null)}
        title={rangeDialog?.title ?? ""}
        initial={rangeDialog?.initial}
        withTrack={rangeDialog?.kind === "milestone"}
        onSubmit={submitRange}
      />

      {canEdit && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          點階段帶可以改期間,點格子填投入,滑到一列右側可以整列填滿或刪除。人月加總會自動寫回各階段的
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
    if (!Number.isFinite(next) || next < 0) {
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
      title="投入多少?1 = 整個月全職,0.5 = 半個月"
      className={`shrink-0 border-l border-neutral-100 py-1 text-center text-[11px] tabular-nums outline-none focus:bg-white focus:ring-1 focus:ring-blue-400 disabled:cursor-default dark:border-neutral-800 dark:focus:bg-neutral-900 ${
        value > 0
          ? "bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200"
          : "bg-transparent text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
      style={{ width }}
    />
  );
}
