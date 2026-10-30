"use client";

import { useState, useTransition } from "react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { setApprovalLevels } from "@/lib/actions/systemSettings";
import { MAX_APPROVAL_LEVELS, levelLabel } from "@/lib/approvalLevels";
import { actionErrorMessage } from "@/lib/userError";

const selectClass =
  "w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

/** 1 → 「直屬主管」,2 → 「直屬主管 + 二階主管」,3 → 「直屬 + 二階 + 三階主管」… */
function optionLabel(levels: number): string {
  if (levels === 1) return levelLabel(1);
  return `${Array.from({ length: levels }, (_, i) => levelLabel(i + 1)).join(" + ")}(都要同意)`;
}

/**
 * 簽核層級:請假、工時的「主管這一條路」要幾階主管都同意才算核准。
 * 誰是誰的直屬、二階、三階主管,看「組織架構圖」。各階同時送審,不用等前一階;
 * 設定要 3 階、但這個人頭上只有 2 階主管,就算到最高那一階。
 */
export function ApprovalLevelsCard({ initial }: { initial: { leave: number; timesheet: number } }) {
  const { notify } = useDialogs();
  const [leave, setLeave] = useState(initial.leave);
  const [timesheet, setTimesheet] = useState(initial.timesheet);
  const [isPending, startTransition] = useTransition();

  function save(next: { leave: number; timesheet: number }) {
    startTransition(async () => {
      try {
        await setApprovalLevels(next);
      } catch (err) {
        setLeave(initial.leave);
        setTimesheet(initial.timesheet);
        await notify(actionErrorMessage(err, "無法儲存簽核層級"), { title: "簽核層級" });
      }
    });
  }

  const options = Array.from({ length: MAX_APPROVAL_LEVELS }, (_, i) => i + 1);

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">簽核層級</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        需要主管同意的簽核,可以要求二階、三階主管也同意。誰是誰的幾階主管,看「組織架構圖」。
        各階同時送審,不用等前一階;<b>所有需要的階都同意</b>才算核准,任何一階退回就是退回;管理者仍可單獨核准或退回。
        設定的階數比這個人頭上實際的主管多,就算到最高那一階。預設是「直屬主管」,跟以前一樣。
      </p>

      <label className="mb-3 block text-xs text-neutral-500 dark:text-neutral-400">
        請假
        <select
          value={leave}
          disabled={isPending}
          onChange={(e) => {
            const value = Number(e.target.value);
            setLeave(value);
            save({ leave: value, timesheet });
          }}
          className={`${selectClass} mt-1`}
          aria-label="請假需要的主管階層"
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {optionLabel(n)}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs text-neutral-500 dark:text-neutral-400">
        工時(主管這一條路)
        <select
          value={timesheet}
          disabled={isPending}
          onChange={(e) => {
            const value = Number(e.target.value);
            setTimesheet(value);
            save({ leave, timesheet: value });
          }}
          className={`${selectClass} mt-1`}
          aria-label="工時需要的主管階層"
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {optionLabel(n)}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">
        工時還有 Team Leader、PMD、部門 DM 這幾條路:他們任一位同意就算核准,不受這個設定影響;這裡管的是「靠主管核准」那一條。
      </p>
    </div>
  );
}
