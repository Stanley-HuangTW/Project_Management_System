"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDelayAnalysis } from "@/lib/actions/delayAnalysis";
import type { DelayAnalysis } from "@/lib/delayAnalysis";

/**
 * 延遲追因 — the answer to "誰害的".
 *
 * On a late project nearly every task is late and nearly none are to blame.
 * This lists only the ones that moved further than their predecessors moved
 * them, or that took longer than they said — and shows both halves of each
 * one's slip, so an argument about it starts from the same numbers.
 */
export function DelayReport({ boardId }: { boardId: string }) {
  const [analysis, setAnalysis] = useState<DelayAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getDelayAnalysis(boardId);
      if (!cancelled) {
        setAnalysis(result);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!analysis) return null;

  if (analysis.noBaseline) {
    return (
      <p className="text-sm text-neutral-400 dark:text-neutral-500">
        尚未建立基準線,沒有計畫可以比對。請至「系統設定」的基準線建立一版。
      </p>
    );
  }

  if (analysis.culprits.length === 0) {
    return (
      <p className="text-sm text-neutral-400 dark:text-neutral-500">
        {analysis.projectDelay > 0
          ? `最晚的工作項比計畫晚 ${analysis.projectDelay} 天,但沒有任何工作項自己延誤——延遲全部是從前置傳下來的,起點在基準線建立之前。`
          : "沒有工作項比計畫晚。"}
      </p>
    );
  }

  const shown = showAll ? analysis.culprits : analysis.culprits.slice(0, 10);

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        整體比計畫晚 <span className="font-semibold text-red-600">{analysis.projectDelay}</span> 天。
        以下 {analysis.culprits.length} 個工作項是<b>自己</b>延誤的——扣掉前置推給它的部分之後還是晚了,
        或是做的天數比計畫多。其餘的工作項只是被推。
      </p>

      <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-700">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">工作項</th>
              <th className="px-2 py-2 text-right font-medium" title="扣掉前置推給它的部分,自己多晚的天數">
                自身延誤
              </th>
              <th className="px-2 py-2 text-right font-medium" title="前置比計畫晚了多少,推到這一項身上">
                前置推的
              </th>
              <th className="px-2 py-2 text-right font-medium" title="實際天數 − 計畫天數">
                天數增加
              </th>
              <th className="px-2 py-2 text-right font-medium" title="完成日比計畫晚幾天">
                完成延遲
              </th>
              <th className="px-2 py-2 text-right font-medium" title="有多少工作項排在它後面,跟著一起被推">
                影響下游
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
            {shown.map((culprit) => (
              <tr key={culprit.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800">
                <td className="max-w-[260px] px-3 py-2">
                  <Link
                    href={`/boards/${boardId}?highlight=${culprit.id}`}
                    className="block truncate text-neutral-800 dark:text-neutral-100 hover:text-blue-600"
                  >
                    <span className="mr-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                      {culprit.wbsCode}
                    </span>
                    {culprit.name}
                  </Link>
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-red-600">
                  +{culprit.ownDelay}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                  {culprit.inheritedDelay > 0 ? `+${culprit.inheritedDelay}` : "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                  {culprit.daysDelta > 0 ? `+${culprit.daysDelta}` : "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                  {culprit.endDelta > 0 ? `+${culprit.endDelta}` : culprit.endDelta}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                  {culprit.downstreamCount > 0 ? `${culprit.downstreamCount} 項` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {analysis.culprits.length > shown.length && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs text-blue-600 hover:underline"
        >
          顯示其餘 {analysis.culprits.length - shown.length} 項
        </button>
      )}

      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        只算葉節點工作項(父項的日期是子項統計來的,列它等於指著資料夾說話)。
        天數比較用工作天,日期差異用日曆天——「晚了 5 天」是大家口中的講法,而排程本身仍走工作天。
      </p>
    </div>
  );
}
