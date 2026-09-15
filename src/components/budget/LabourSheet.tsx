"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2, Pencil } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { formatMoney } from "@/lib/cost";
import { DISCIPLINES, DISCIPLINE_LABELS } from "@/lib/labourPlan";
import { monthKeyOf } from "@/lib/labourSheet";
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

  /** 起訖日期兩問,兩者都要有才算數。 */
  async function askRange(what: string, start?: string, end?: string) {
    const from = await prompt(`${what}從哪一天開始?格式 2026-03-02`, {
      title: what,
      defaultValue: start ?? "",
    });
    if (from === null || !from.trim()) return null;
    const to = await prompt(`${what}到哪一天結束?格式 2026-05-31`, {
      title: what,
      defaultValue: end ?? "",
    });
    if (to === null || !to.trim()) return null;
    return { start: from.trim(), end: to.trim() };
  }

  async function addPhase() {
    const name = await prompt("階段名稱?例如 EFS、EVT、DVT1", { title: "新增預算階段" });
    if (name === null || !name.trim()) return;
    const range = await askRange(`${name.trim()} 的期間`);
    if (!range) return;
    await run(
      () =>
        upsertBudgetPhase(boardId, {
          name: name.trim(),
          startDate: range.start,
          endDate: range.end,
          itemId: null,
        }),
      "無法新增階段"
    );
  }

  async function editPhase(phase: LabourSheetView["phases"][number]) {
    const range = await askRange(`${phase.name} 的期間`, phase.startDate, phase.endDate);
    if (!range) return;
    await run(
      () =>
        upsertBudgetPhase(boardId, {
          id: phase.id,
          name: phase.name,
          startDate: range.start,
          endDate: range.end,
          itemId: phase.itemId,
        }),
      "無法儲存階段"
    );
  }

  async function addMilestone() {
    const track = await prompt("排在哪一列?例如 軟體、機構、認證", {
      title: "新增里程碑",
      defaultValue: "里程碑",
    });
    if (track === null) return;
    const name = await prompt("里程碑名稱?例如 PCBA 打件、機構出圖、demo 樣機", {
      title: "新增里程碑",
    });
    if (name === null || !name.trim()) return;
    const range = await askRange(`${name.trim()} 的期間`);
    if (!range) return;
    await run(
      () =>
        upsertPlanMilestone(boardId, {
          track: track.trim() || "里程碑",
          name: name.trim(),
          startDate: range.start,
          endDate: range.end,
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

  async function editCell(slotId: string, slotLabel: string, month: string, current: number) {
    const answer = await prompt(
      `${slotLabel} 在 ${month} 投入多少?1 = 整個月全職,0.5 = 半個月。輸入 0 清掉這一格。`,
      { title: "設定投入", defaultValue: current > 0 ? String(current) : "", numeric: true }
    );
    if (answer === null || answer.trim() === "") return;
    const fte = Number(answer);
    if (!Number.isFinite(fte)) return;
    await run(() => setLabourSlotMonth(boardId, slotId, month, fte), "無法儲存");
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

  const { sheet, phases, milestones, slots, canEdit, variances } = view;
  const months = sheet.months;
  const totalOf = new Map(sheet.slotTotals.map((t) => [t.slotId, t]));
  const rateOf = new Map(view.rates.map((r) => [r.discipline, r.monthlySalary]));
  const tracks = [...new Set(milestones.map((m) => m.track))];
  const timelineWidth = months.length * MONTH_WIDTH;

  /** 一條帶在月份軸上的位置。月份是最小刻度,所以跨到哪個月就畫到哪個月。 */
  function band(startDate: string, endDate: string) {
    const from = months.indexOf(monthKeyOf(startDate));
    const to = months.indexOf(monthKeyOf(endDate));
    if (from === -1 && to === -1) return null;
    const left = Math.max(0, from);
    const right = to === -1 ? months.length - 1 : to;
    return { left: left * MONTH_WIDTH, width: (right - left + 1) * MONTH_WIDTH };
  }

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

          {/* 階段帶 */}
          <div className="flex items-center border-b border-neutral-200 dark:border-neutral-700">
            <div
              style={{ width: LABEL_WIDTH }}
              className="shrink-0 px-2 py-1 text-xs font-medium text-neutral-600 dark:text-neutral-300"
            >
              預算階段
            </div>
            <div className="relative shrink-0" style={{ width: timelineWidth, height: 26 }}>
              {phases.map((phase) => {
                const box = band(phase.startDate, phase.endDate);
                if (!box) return null;
                return (
                  <button
                    key={phase.id}
                    type="button"
                    disabled={!canEdit || busy}
                    onClick={() => editPhase(phase)}
                    title={`${phase.name}:${phase.startDate} ~ ${phase.endDate}${canEdit ? "(點選修改期間)" : ""}`}
                    className="absolute top-1 flex h-5 items-center justify-center overflow-hidden rounded-sm bg-amber-400 px-1 text-[10px] font-medium text-amber-950 hover:ring-1 hover:ring-amber-600 disabled:cursor-default dark:bg-amber-500"
                    style={{ left: box.left + 1, width: box.width - 2 }}
                  >
                    {phase.name}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-1 items-center justify-end gap-1 px-2">
              {canEdit &&
                phases.map((phase) => (
                  <button
                    key={phase.id}
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirm(
                        `刪除階段「${phase.name}」?它推算出來的人力預算會一併收回。`,
                        { title: "刪除階段", confirmLabel: "刪除", danger: true }
                      );
                      if (ok) await run(() => deleteBudgetPhase(boardId, phase.id), "無法刪除");
                    }}
                    title={`刪除 ${phase.name}`}
                    className="rounded p-0.5 text-neutral-300 hover:text-red-600 disabled:opacity-50 dark:text-neutral-600"
                  >
                    <Trash2 size={11} />
                  </button>
                ))}
            </div>
          </div>

          {/* 里程碑帶,一個 track 一列 */}
          {tracks.map((track) => (
            <div key={track} className="flex items-center border-b border-neutral-200 dark:border-neutral-700">
              <div
                style={{ width: LABEL_WIDTH }}
                className="shrink-0 truncate px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400"
              >
                {track}
              </div>
              <div className="relative shrink-0" style={{ width: timelineWidth, height: 24 }}>
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

                      {months.map((m) => {
                        const fte = slot.months[m] ?? 0;
                        return (
                          <button
                            key={m}
                            type="button"
                            disabled={!canEdit || busy}
                            onClick={() => editCell(slot.id, slot.label, m, fte)}
                            className={`shrink-0 border-l border-neutral-100 py-1 text-center text-[11px] tabular-nums disabled:cursor-default dark:border-neutral-800 ${
                              fte > 0
                                ? "bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200"
                                : "text-neutral-300 hover:bg-neutral-100 dark:text-neutral-700 dark:hover:bg-neutral-800"
                            }`}
                            style={{ width: MONTH_WIDTH }}
                          >
                            {fte > 0 ? fte : "·"}
                          </button>
                        );
                      })}

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
