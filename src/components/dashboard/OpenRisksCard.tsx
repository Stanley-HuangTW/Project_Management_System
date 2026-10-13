"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { relatedToUsers, summariseOpenRisks, type OpenRiskRow } from "@/lib/dashboardRisks";
import { riskBand, riskLinkTag, RISK_STATUS_LABELS } from "@/lib/riskRegister";

const COLLAPSED_COUNT = 8;

/**
 * 儀表板:未結案的風險與問題(風險登記冊裡還沒結案的,含 Mantis 同步來的)。
 * 「與我有關」= 我是負責人、或正在等我同意結案(主管連部屬的一起算);「全部」= 這幾個看板上所有未結案的。
 * 點一筆跳到那個看板的風險分頁。
 */
export function OpenRisksCard({
  rows,
  relatedUserIds,
  defaultAll,
}: {
  rows: OpenRiskRow[];
  relatedUserIds: string[];
  /** 管理者預設看全部;其他人預設看「與我有關」(沒有的話看全部)。 */
  defaultAll: boolean;
}) {
  const related = new Set(relatedUserIds);
  const mine = rows.filter((r) => relatedToUsers(r, related));
  const [scope, setScope] = useState<"mine" | "all" | null>(null);
  const [expanded, setExpanded] = useState(false);

  const active = scope ?? (defaultAll || mine.length === 0 ? "all" : "mine");
  const shownRows = active === "mine" ? mine : rows;
  const visible = expanded ? shownRows : shownRows.slice(0, COLLAPSED_COUNT);
  const summary = summariseOpenRisks(shownRows);

  const tab = (key: "mine" | "all", label: string, count: number) => (
    <button
      type="button"
      onClick={() => {
        setScope(key);
        setExpanded(false);
      }}
      aria-pressed={active === key}
      className={`rounded-full border px-2.5 py-0.5 text-xs ${
        active === key
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {label} {count}
    </button>
  );

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700 dark:text-neutral-100">
          <ShieldAlert size={14} /> 未結案的風險與問題({rows.length})
        </h2>
        {tab("mine", "與我有關", mine.length)}
        {tab("all", "全部", rows.length)}
        {shownRows.length > 0 && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            風險 {summary.risks}・問題 {summary.issues}
            {summary.critical > 0 && <span className="ml-2 font-medium text-red-800 dark:text-red-300">極高 {summary.critical}</span>}
            {summary.high > 0 && <span className="ml-2 text-red-600 dark:text-red-400">高 {summary.high}</span>}
            {summary.overdue > 0 && <span className="ml-2 text-amber-700 dark:text-amber-400">逾期 {summary.overdue}</span>}
          </span>
        )}
      </div>

      {shownRows.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 py-6 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
          {active === "mine" ? "目前沒有跟你有關、還沒結案的風險或問題。" : "目前沒有未結案的風險或問題。"}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-700 dark:bg-neutral-900">
          {visible.map((r) => (
            <li key={r.id}>
              <Link
                href={`/boards/${r.boardId}?view=risks`}
                className="flex items-start gap-3 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <span
                  className="mt-0.5 w-9 shrink-0 rounded px-1 py-0.5 text-center text-xs font-semibold tabular-nums text-white"
                  style={{ backgroundColor: riskBand(r.score).color }}
                  title={`${r.bandLabel}(機率 ${r.probability} × 衝擊 ${r.impact})`}
                >
                  {r.score}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded bg-neutral-100 px-1.5 text-[11px] leading-5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {riskLinkTag(r)}
                    </span>
                    <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{r.title}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {r.boardName}・{RISK_STATUS_LABELS[r.status]}・負責人 {r.ownerName ?? "未指定"}
                    {r.dueDate && (
                      <span className={r.overdue ? "ml-1 font-medium text-red-600 dark:text-red-400" : "ml-1"}>
                        ・到期 {r.dueDate}
                        {r.overdue && "(逾期)"}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {shownRows.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
          {expanded ? "收合" : `顯示全部 ${shownRows.length} 筆`}
        </button>
      )}
    </section>
  );
}
