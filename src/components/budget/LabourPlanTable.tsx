"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { formatMoney } from "@/lib/cost";
import { unitLabel } from "@/lib/orgUnits";
import { getLabourPlanView, type LabourPlanView } from "@/lib/actions/labourPlan";
import { HScrollPane } from "@/components/ui/HScrollPane";

/**
 * 階段 × 單位的人月彙總 —— 唯讀。
 *
 * 人月是「人力表」每個名額逐月投入加總而來的,哪個月算哪個階段由日期決定,
 * 所以這裡不是輸入端。一列加起來就是那個階段的人力預算,「各類別」的人力
 * 那一列讀的就是它。
 */
export function LabourPlanTable({ boardId }: { boardId: string }) {
  const [view, setView] = useState<LabourPlanView | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!view) return null;

  const { summary, canEdit } = view;
  const rateOf = new Map(view.rates.map((r) => [r.discipline, r.monthlySalary]));

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        這張是彙總,不是輸入:人月由「人力表」每個名額逐月的投入加總而來,哪個月算哪個階段由日期決定。
        要改人月請到人力表。乘上單位標準月薪就是金額,會直接寫進「各類別」的人力那一列。
      </p>

      {/* 整張表都是「—」的時候,最常見的原因是階段沒對應到看板的階段列 ——
          而那件事在另一個分頁裡,光看這張表看不出來。 */}
      {summary.totalPersonMonths === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p>
            這張表現在是空的。人月是從「人力表」的階段寫回來的,而階段要先
            <strong>對應到看板上的階段列</strong>才寫得回來 —— 到「人力表」點任一條階段長條,
            在「對應看板階段」選一列就會開始計算。
          </p>
        </div>
      )}

      {summary.unpricedDisciplines.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p>
            {summary.unpricedDisciplines.map((d) => unitLabel(view.units, d)).join("、")}
            有排人月,但還沒有標準月薪,所以那幾格算不出金額。請先到系統設定填上標準月薪。
          </p>
        </div>
      )}

      <HScrollPane>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-700 text-xs text-neutral-500 dark:text-neutral-400">
              <th className="py-2 text-left font-normal">階段</th>
              {view.units.map(({ code: d }) => (
                <th key={d} className="py-2 text-right font-normal">
                  {unitLabel(view.units, d)}
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
                {row.cells.map((cell) => (
                    <td key={cell.discipline} className="py-1.5 text-right tabular-nums">
                      <span
                        title={cell.amount > 0 ? `${formatMoney(cell.amount)} 元` : undefined}
                        className="block px-1.5 py-0.5 text-right"
                      >
                        {cell.personMonths > 0 ? (
                          <span className="text-neutral-800 dark:text-neutral-100">{cell.personMonths}</span>
                        ) : (
                          <span className="text-neutral-300 dark:text-neutral-600">—</span>
                        )}
                      </span>
                    </td>
                ))}
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
      </HScrollPane>

      {!canEdit && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          你沒有編輯這個看板預算的權限,以上為唯讀。
        </p>
      )}
    </div>
  );
}
