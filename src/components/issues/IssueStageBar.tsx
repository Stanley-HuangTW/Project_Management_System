"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { moveIssueStage } from "@/lib/actions/issueFlow";
import { ISSUE_LANE_LABELS, ISSUE_STAGE_LABELS, STAGE_LANE, stageTrack, type IssueStage } from "@/lib/issueFlow";
import type { IssueCaseDetail } from "@/lib/issueTypes";
import { actionErrorMessage } from "@/lib/userError";
import { useDialogs } from "@/components/ui/DialogProvider";
import { buttonClass } from "./issueUi";

/**
 * 客服維修流程的進度條:案件走到哪一階、現在輪到誰,以及這個人現在可以做的移動
 * (往下一階、退回、Issue 轉 Repair)。沒有權限推進的人只看得到進度。
 */
export function IssueStageBar({ detail }: { detail: IssueCaseDetail }) {
  const router = useRouter();
  const { confirm } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const track = stageTrack(detail.kind);
  const at = track.indexOf(detail.stage);
  const lane = STAGE_LANE[detail.stage];

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "操作失敗"));
    } finally {
      setBusy(false);
    }
  }

  async function move(to: IssueStage, direction: "FORWARD" | "BACK") {
    if (direction === "BACK" && !(await confirm(`要把案件退回到「${ISSUE_STAGE_LABELS[to]}」嗎?`, { title: "退回階段", confirmLabel: "退回" }))) return;
    await run(() => moveIssueStage(detail.id, to));
  }

  return (
    <section className="mb-4 rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900" data-testid="stage-bar" data-issue-flow>
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {track.map((s, i) => {
          const done = i < at;
          const current = i === at;
          return (
            <li key={s} className="flex items-center gap-1">
              <span
                data-testid={`stage-${s}`}
                data-current={current ? "1" : undefined}
                title={STAGE_LANE[s] ? `輪到 ${ISSUE_LANE_LABELS[STAGE_LANE[s]!]}` : undefined}
                className={`rounded-full px-2.5 py-1 font-medium ${
                  current
                    ? "bg-blue-600 text-white"
                    : done
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                }`}
              >
                {ISSUE_STAGE_LABELS[s]}
              </span>
              {i < track.length - 1 && <span className="text-neutral-300 dark:text-neutral-600">›</span>}
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500 dark:text-neutral-400" data-testid="stage-turn">
          {lane ? `現在輪到:${ISSUE_LANE_LABELS[lane]}` : detail.stage === "CLOSED" ? "已結案" : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {detail.flow.moves.map((m) => (
            <button
              key={m.to}
              type="button"
              disabled={busy}
              onClick={() => void move(m.to, m.direction)}
              className={`${buttonClass} ${m.direction === "BACK" ? "text-neutral-500" : ""}`}
              data-testid={`stage-move-${m.to}`}
            >
              {m.direction === "BACK" ? <ArrowLeft size={13} /> : null}
              {m.direction === "BACK" ? `退回到${ISSUE_STAGE_LABELS[m.to]}` : ISSUE_STAGE_LABELS[m.to]}
              {m.direction === "FORWARD" ? <ArrowRight size={13} /> : null}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-testid="stage-error">{error}</div>}
    </section>
  );
}
