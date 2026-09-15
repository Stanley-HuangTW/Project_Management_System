"use client";

import { useCallback, useEffect, useState } from "react";
import type { Discipline } from "@prisma/client";
import { AlertTriangle } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { formatMoney } from "@/lib/cost";
import { DISCIPLINES, DISCIPLINE_LABELS } from "@/lib/labourPlan";
import {
  getLabourPlanView,
  setLabourPlanCell,
  type LabourPlanView,
} from "@/lib/actions/labourPlan";

/**
 * 人力規劃表:階段 × 單位,每一格填人月。
 *
 * 每一格的金額是人月 × 該單位的標準月薪,一列加起來就是那個階段的人力
 * 預算 —— 所以「各類別」裡的人力那一列不是手填的,是這張表算出來的。
 * 這也是為什麼編預算時不必先知道會派誰去做。
 */
export function LabourPlanTable({ boardId }: { boardId: string }) {
  const { notify, prompt } = useDialogs();
  const [view, setView] = useState<LabourPlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reload = useCallback(async () => setView(await getLabourPlanView(boardId)), [boardId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getLabourPlanView(boardId);
        if (!cancelled) setView(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  async function editCell(
    itemId: string,
    itemName: string,
    discipline: Discipline,
    current: number
  ) {
    const answer = await prompt(
      `${itemName} 的${DISCIPLINE_LABELS[discipline]}要投入幾個人月?輸入 0 可以清掉這一格。`,
      {
        title: "設定人月",
        defaultValue: current > 0 ? String(current) : "",
        numeric: true,
      }
    );
    if (answer === null || answer.trim() === "") return;
    const personMonths = Number(answer);
    if (!Number.isFinite(personMonths) || personMonths < 0) return;

    const key = `${itemId}:${discipline}`;
    setBusyKey(key);
    try {
      const result = await setLabourPlanCell(itemId, discipline, personMonths);
      if (result.error) {
        await notify(result.error, { title: "無法儲存" });
        return;
      }
      await reload();
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : "無法儲存" }
      );
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!view) return null;

  const { summary, canEdit } = view;
  const rateOf = new Map(view.rates.map((r) => [r.discipline, r.monthlySalary]));

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        每一格是人月,乘上該單位的標準月薪就是金額。一列加起來就是那個階段的人力預算,會直接寫進
        「各類別」的人力那一列 —— 所以人力不必再手動填金額。標準月薪在系統設定裡。
      </p>

      {summary.unpricedDisciplines.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p>
            {summary.unpricedDisciplines.map((d) => DISCIPLINE_LABELS[d]).join("、")}
            有排人月,但還沒有標準月薪,所以那幾格算不出金額。請先到系統設定填上標準月薪。
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-700 text-xs text-neutral-500 dark:text-neutral-400">
              <th className="py-2 text-left font-normal">階段</th>
              {DISCIPLINES.map((d) => (
                <th key={d} className="py-2 text-right font-normal">
                  {DISCIPLINE_LABELS[d]}
                  <span className="block text-[10px] text-neutral-400 dark:text-neutral-500">
                    {rateOf.get(d) ? `${formatMoney(rateOf.get(d)!)}/月` : "未設標準價"}
                  </span>
                </th>
              ))}
              <th className="py-2 text-right font-normal">人月合計</th>
              <th className="py-2 text-right font-normal">金額</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.itemId} className="border-b border-neutral-100 dark:border-neutral-800">
                <td className="py-1.5 pr-3 text-neutral-800 dark:text-neutral-100">{row.itemName}</td>
                {row.cells.map((cell) => {
                  const key = `${row.itemId}:${cell.discipline}`;
                  return (
                    <td key={cell.discipline} className="py-1.5 text-right tabular-nums">
                      <button
                        type="button"
                        disabled={!canEdit || busyKey === key}
                        onClick={() => editCell(row.itemId, row.itemName, cell.discipline, cell.personMonths)}
                        title={cell.amount > 0 ? `${formatMoney(cell.amount)} 元` : undefined}
                        className={`w-full rounded px-1.5 py-0.5 text-right ${
                          canEdit ? "hover:bg-neutral-100 dark:hover:bg-neutral-800" : "cursor-default"
                        } disabled:opacity-60`}
                      >
                        {cell.personMonths > 0 ? (
                          <span className="text-neutral-800 dark:text-neutral-100">{cell.personMonths}</span>
                        ) : (
                          <span className="text-neutral-300 dark:text-neutral-600">—</span>
                        )}
                      </button>
                    </td>
                  );
                })}
                <td className="py-1.5 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                  {row.personMonths > 0 ? row.personMonths : "—"}
                </td>
                <td className="py-1.5 text-right tabular-nums text-neutral-800 dark:text-neutral-100">
                  {row.amount > 0 ? formatMoney(row.amount) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium text-neutral-800 dark:text-neutral-100">
              <td className="py-2 pr-3">合計</td>
              {summary.byDiscipline.map((d) => (
                <td key={d.discipline} className="py-2 text-right tabular-nums">
                  {d.personMonths > 0 ? (
                    <span title={`${formatMoney(d.amount)} 元`}>{d.personMonths}</span>
                  ) : (
                    <span className="text-neutral-300 dark:text-neutral-600">—</span>
                  )}
                </td>
              ))}
              <td className="py-2 text-right tabular-nums">{summary.totalPersonMonths}</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(summary.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!canEdit && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          你沒有編輯這個看板預算的權限,以上為唯讀。
        </p>
      )}
    </div>
  );
}
