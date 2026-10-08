"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BoardWithData } from "@/types/board";
import { listBudgetPhases } from "@/lib/actions/labourSheet";
import { BudgetPanel } from "./BudgetPanel";
import { NreQuoteSheet } from "./NreQuoteSheet";
import { LabourPlanTable } from "./LabourPlanTable";
import { LabourSheet } from "./LabourSheet";
import { ProtoPlanTable } from "./ProtoPlanTable";
import { BomTable } from "./BomTable";

type PhaseOption = { id: string; name: string; itemId: string | null };

/**
 * 預算 on a board: one 預算階段 at a time.
 *
 * 階段來自「人力表」上畫出來的那幾段(EFS、EVT、DVT1……),而不是看板最上層
 * 那幾列工作項:預算是計畫,DVT1 與 DVT2 是兩段各自要編預算的計畫,即使它們
 * 對到看板上同一列。用工作項當範圍的話,那兩段會被擠成一筆,誰也看不出哪
 * 一段花得多。
 *
 * The whole-project figure lives on the 專案群組 page, where the project is.
 */
export function BoardBudget({ board }: { board: BoardWithData }) {
  const [phases, setPhases] = useState<PhaseOption[] | null>(null);
  const [phaseId, setPhaseId] = useState("");
  // 人力規劃橫跨所有階段,所以它不在階段面板裡面,而是跟它並排的另一個視圖。
  const [view, setView] = useState<"phase" | "nre" | "sheet" | "proto" | "bom" | "labour">("phase");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listBudgetPhases(board.id);
      if (cancelled) return;
      setPhases(result);
      // 只在還沒選過的時候幫他選第一個 —— 每次回到這個分頁都重設的話,剛看
      // 到一半的階段會被跳掉。
      setPhaseId((current) =>
        result.some((p) => p.id === current) ? current : result[0]?.id ?? ""
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [board.id]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        {(
          [
            ["phase", "階段預算"],
            ["nre", "NRE 報價單"],
            ["sheet", "人力表"],
            ["proto", "樣機計畫"],
            ["bom", "樣機 BOM"],
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
      ) : view === "bom" ? (
        <BomTable boardId={board.id} />
      ) : view === "labour" ? (
        <LabourPlanTable boardId={board.id} />
      ) : phases === null ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : phases.length === 0 ? (
        // 分頁列留在上面沒有被這段擋掉 —— 要新增階段得去「人力表」,把入口
        // 一起藏起來的話就沒地方可以去了。
        <p className="rounded-md border border-dashed border-neutral-200 py-12 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
          這個看板還沒有預算階段。到「人力表」上新增階段(EFS、EVT、DVT……),預算就掛在它身上。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
              {view === "nre" ? "NRE 報價單" : "預算管控"}
            </h2>
            <select
              value={phaseId}
              onChange={(e) => setPhaseId(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
            >
              {phases.map((phase) => (
                <option key={phase.id} value={phase.id}>
                  {phase.name}
                  {phase.itemId ? "" : "(未對應看板)"}
                </option>
              ))}
            </select>
            {view === "nre" ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                報價單按「人力表」上的階段各填一份。
              </p>
            ) : (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                預算按「人力表」上的階段核准。實際花費記在對應到的那一列工作項底下,沒對應的階段
                只有預估、還沒有實際數字可以對。整個專案的總預算在
                {board.programId ? (
                  <Link
                    href={`/programs/${board.programId}`}
                    className="mx-0.5 text-blue-600 hover:underline"
                  >
                    專案群組
                  </Link>
                ) : (
                  <span className="mx-0.5">專案群組</span>
                )}
                頁面。
              </p>
            )}
          </div>

          {phaseId &&
            (view === "nre" ? (
              <NreQuoteSheet key={phaseId} phaseId={phaseId} />
            ) : (
              <BudgetPanel key={phaseId} scope={{ kind: "phase", id: phaseId }} />
            ))}
        </>
      )}
    </div>
  );
}
