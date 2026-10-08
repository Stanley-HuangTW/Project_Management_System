"use client";

import { useEffect, useState } from "react";
import { HScrollPane } from "@/components/ui/HScrollPane";
import { formatMoney } from "@/lib/cost";
import { getNreProject, type NreProject } from "@/lib/actions/nre";
import { NRE_CATEGORIES, NRE_LABELS, WHOLE_PROJECT_LABEL, formatDateRange } from "@/lib/nre";

/**
 * 整個專案的 NRE:每個階段的報價單、每一類的小計,涵蓋整個專案的委託開發另成一列,最後是全部加總;
 * 下面列出委託開發的明細(委託單位、委託項目、時間範圍、範圍)。唯讀——要編輯、匯入、匯出請在上面選單一階段。
 */
export function NreProjectTable({ boardId }: { boardId: string }) {
  const [project, setProject] = useState<NreProject | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getNreProject(boardId);
      if (!cancelled) setProject(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  if (project === undefined) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (project === null) return <p className="text-sm text-neutral-400 dark:text-neutral-500">找不到這個看板。</p>;

  const { summary, commissioned, phases } = project;
  const phaseName = (id: string | null) => (id === null ? WHOLE_PROJECT_LABEL : (phases.find((p) => p.id === id)?.name ?? ""));
  const hasProjectWide = commissioned.some((l) => l.phaseId === null);
  const cell = "px-3 py-1.5 text-right tabular-nums";
  const money = (n: number) => (n === 0 ? "—" : formatMoney(n));
  return (
    <div className="space-y-3">
      <p className="rounded-md border border-dashed border-neutral-300 p-2 text-xs text-neutral-500 dark:border-neutral-600 dark:text-neutral-400">
        這是整個專案(全部階段)的 NRE 合計,唯讀。要編輯、匯入或匯出報價單,請在上面選單一階段。
      </p>
      <HScrollPane className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">階段</th>
              {NRE_CATEGORIES.map((c) => (
                <th key={c} className="px-3 py-2 text-right font-medium">
                  {NRE_LABELS[c]}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">合計(元)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {summary.rows.map((row) => (
              <tr key={row.phaseId}>
                <td className="px-3 py-1.5 text-neutral-800 dark:text-neutral-100">{row.phaseName}</td>
                {NRE_CATEGORIES.map((c) => (
                  <td key={c} className={`${cell} text-neutral-700 dark:text-neutral-200`}>
                    {money(row.byCategory[c])}
                  </td>
                ))}
                <td className={`${cell} font-medium text-neutral-800 dark:text-neutral-100`}>{money(row.total)}</td>
              </tr>
            ))}
            {hasProjectWide && (
              <tr>
                <td className="px-3 py-1.5 text-neutral-800 dark:text-neutral-100">涵蓋整個專案</td>
                {NRE_CATEGORIES.map((c) => (
                  <td key={c} className={`${cell} text-neutral-700 dark:text-neutral-200`}>
                    {money(summary.projectWide.byCategory[c])}
                  </td>
                ))}
                <td className={`${cell} font-medium text-neutral-800 dark:text-neutral-100`}>{money(summary.projectWide.total)}</td>
              </tr>
            )}
            {summary.rows.length === 0 && !hasProjectWide && (
              <tr>
                <td colSpan={NRE_CATEGORIES.length + 2} className="px-3 py-6 text-center text-neutral-400 dark:text-neutral-500">
                  這個看板還沒有預算階段。
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t-2 border-neutral-300 font-semibold dark:border-neutral-600">
            <tr>
              <td className="px-3 py-2 text-neutral-900 dark:text-neutral-50">整個專案</td>
              {NRE_CATEGORIES.map((c) => (
                <td key={c} className={`${cell} text-neutral-900 dark:text-neutral-50`}>
                  {money(summary.byCategory[c])}
                </td>
              ))}
              <td className={`${cell} text-neutral-900 dark:text-neutral-50`}>{formatMoney(summary.total)}</td>
            </tr>
          </tfoot>
        </table>
      </HScrollPane>

      {commissioned.length > 0 && (
        <section className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <header className="border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{NRE_LABELS.COMMISSIONED}明細</h3>
          </header>
          <HScrollPane>
            <table className="w-full min-w-[720px] text-xs">
              <thead className="text-neutral-500 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">範圍</th>
                  <th className="px-3 py-1.5 text-left font-medium">委託項目</th>
                  <th className="px-3 py-1.5 text-left font-medium">委託單位</th>
                  <th className="px-3 py-1.5 text-left font-medium">時間範圍</th>
                  <th className="px-3 py-1.5 text-right font-medium">金額(元)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {commissioned.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-1.5 text-neutral-700 dark:text-neutral-200">{phaseName(l.phaseId)}</td>
                    <td className="px-3 py-1.5 text-neutral-800 dark:text-neutral-100">{l.description}</td>
                    <td className="px-3 py-1.5 text-neutral-700 dark:text-neutral-200">{l.vendor || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-neutral-700 dark:text-neutral-200">
                      {formatDateRange(l.startDate, l.endDate) || "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-neutral-800 dark:text-neutral-100">{formatMoney(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScrollPane>
        </section>
      )}
    </div>
  );
}
