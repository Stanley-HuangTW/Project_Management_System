"use client";

import { useState } from "react";
import { BarChart3, GanttChartSquare, Clock, Wallet } from "lucide-react";
import type { UserRole } from "@prisma/client";
import type { ProgramView as ProgramViewData } from "@/lib/programView";
import type { UserOption } from "@/types/board";
import { ProgramGantt } from "./ProgramGantt";
import { CostReport } from "@/components/board/CostReport";
import { DelayReport } from "@/components/board/DelayReport";
import { BudgetPanel } from "@/components/budget/BudgetPanel";
import { withWeekday } from "@/lib/weekdayLabel";

type Tab = "gantt" | "budget" | "cost" | "delay";

/**
 * A 專案群組 seen as one project.
 *
 * The summary line is the point of the page: a group exists because several
 * boards deliver one thing, and until now nothing could say when that thing
 * finishes — each board could only answer for its own part.
 */
export function ProgramView({
  view,
  holidays,
  users,
  currentUserId,
  userRole,
}: {
  view: ProgramViewData;
  holidays: string[];
  users: UserOption[];
  currentUserId: string;
  userRole: UserRole;
}) {
  const [tab, setTab] = useState<Tab>("gantt");

  const tabs: { id: Tab; label: string; Icon: typeof BarChart3 }[] = [
    { id: "gantt", label: "甘特圖", Icon: GanttChartSquare },
    { id: "budget", label: "預算", Icon: Wallet },
    { id: "cost", label: "成本報表", Icon: BarChart3 },
    { id: "delay", label: "延遲追因", Icon: Clock },
  ];

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{view.name}</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            專案群組 · {view.boards.length} 個看板
            {view.hiddenBoardCount > 0 && `(另有 ${view.hiddenBoardCount} 個你沒有權限開啟,未列入計算)`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                tab === id
                  ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                  : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="整體開始" value={view.startDate ? withWeekday(view.startDate) : "—"} />
        <SummaryTile
          label="整體完工"
          value={view.finishDate ? withWeekday(view.finishDate) : "—"}
          hint="整個群組最後一項工作結束的日子"
          emphasis
        />
        <SummaryTile
          label="要徑工作項"
          value={String(view.criticalCount)}
          hint="總浮時為 0 — 延一天,整個群組就延一天"
        />
        <SummaryTile
          label="跨看板相依"
          value={String(view.crossBoardEdgeCount)}
          hint="前置與後續分屬不同看板的相依數"
        />
      </div>

      {view.boards.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-12 text-center text-sm text-neutral-400 dark:text-neutral-500">
          這個群組還沒有看板。到「系統設定 → 專案群組」把看板加進來,前置依賴就可以跨看板,
          要徑和完工日也會整組一起算。
        </p>
      ) : (
        <>
          {tab === "gantt" && (
            <ProgramGantt view={view} holidays={holidays} users={users} currentUserId={currentUserId} userRole={userRole} />
          )}
          {tab === "budget" && <BudgetPanel scope={{ kind: "program", id: view.id }} />}
          {tab === "cost" && <CostReport programId={view.id} />}
          {tab === "delay" && <DelayReport programId={view.id} />}
        </>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2"
      title={hint}
    >
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</p>
      <p
        className={`tabular-nums ${
          emphasis
            ? "text-lg font-semibold text-neutral-900 dark:text-neutral-100"
            : "text-lg text-neutral-800 dark:text-neutral-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
