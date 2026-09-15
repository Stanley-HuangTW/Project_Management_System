"use client";

import { useState } from "react";
import Link from "next/link";
import type { BoardWithData } from "@/types/board";
import { BudgetPanel } from "./BudgetPanel";
import { LabourPlanTable } from "./LabourPlanTable";
import { LabourSheet } from "./LabourSheet";
import { ProtoPlanTable } from "./ProtoPlanTable";

/**
 * 預算 on a board: one phase at a time.
 *
 * A phase here is a top-level row — POC Phase, EVT Phase — not a 分組, because
 * that is how these boards are actually built: one group holding the whole
 * project, with the phases as its first level. 閘門 hangs off the same rows.
 *
 * The whole-project figure lives on the 專案群組 page, where the project is.
 */
export function BoardBudget({ board }: { board: BoardWithData }) {
  const phases = board.items.filter((item) => item.parentId === null);
  const [itemId, setItemId] = useState(phases[0]?.id ?? "");
  // 人力規劃橫跨所有階段,所以它不在階段面板裡面,而是跟它並排的另一個視圖。
  const [view, setView] = useState<"phase" | "sheet" | "proto" | "labour">("phase");

  if (phases.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-12 text-center text-sm text-neutral-400 dark:text-neutral-500">
        這個看板還沒有工作項,無處掛預算。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        {(
          [
            ["phase", "階段預算"],
            ["sheet", "人力表"],
            ["proto", "樣機計畫"],
            ["labour", "人力規劃彙總"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`rounded-md px-2.5 py-1 text-sm ${
              view === id
                ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "sheet" ? (
        <LabourSheet boardId={board.id} />
      ) : view === "proto" ? (
        <ProtoPlanTable boardId={board.id} />
      ) : view === "labour" ? (
        <LabourPlanTable boardId={board.id} />
      ) : (
        <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">預算管控</h2>
        <select
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
        >
          {phases.map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          預算按階段核准,涵蓋該階段底下所有工作項。整個專案的總預算在
          {board.programId ? (
            <Link href={`/programs/${board.programId}`} className="mx-0.5 text-blue-600 hover:underline">
              專案群組
            </Link>
          ) : (
            <span className="mx-0.5">專案群組</span>
          )}
          頁面。
        </p>
      </div>

      {itemId && <BudgetPanel key={itemId} scope={{ kind: "item", id: itemId }} />}
        </>
      )}
    </div>
  );
}
