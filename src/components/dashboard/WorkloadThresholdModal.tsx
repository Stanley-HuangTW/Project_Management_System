"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { updateWorkloadThreshold } from "@/lib/actions/workloadThreshold";
import type { WorkloadThresholdSettings } from "@/lib/workload";
import { actionErrorMessage } from "@/lib/userError";

export function WorkloadThresholdModal({
  threshold,
  open,
  onOpenChange,
}: {
  threshold: WorkloadThresholdSettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [greenMax, setGreenMax] = useState(threshold.greenMax);
  const [yellowMax, setYellowMax] = useState(threshold.yellowMax);
  const [greenColor, setGreenColor] = useState(threshold.greenColor);
  const [yellowColor, setYellowColor] = useState(threshold.yellowColor);
  const [redColor, setRedColor] = useState(threshold.redColor);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      await updateWorkloadThreshold({ greenMax, yellowMax, greenColor, yellowColor, redColor });
      onOpenChange(false);
    } catch (err) {
      setError(actionErrorMessage(err, "儲存失敗"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="工作量顏色門檻設定">
      {error && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={greenColor}
            onChange={(e) => setGreenColor(e.target.value)}
            className="h-8 w-8 shrink-0 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600"
          />
          <span className="w-16 shrink-0 text-sm text-neutral-600 dark:text-neutral-400">低於</span>
          <input
            type="number"
            value={greenMax}
            onChange={(e) => setGreenMax(Number(e.target.value))}
            className="w-20 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <span className="text-sm text-neutral-500 dark:text-neutral-400">% 顯示此色</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={yellowColor}
            onChange={(e) => setYellowColor(e.target.value)}
            className="h-8 w-8 shrink-0 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600"
          />
          <span className="w-16 shrink-0 text-sm text-neutral-600 dark:text-neutral-400">低於</span>
          <input
            type="number"
            value={yellowMax}
            onChange={(e) => setYellowMax(Number(e.target.value))}
            className="w-20 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <span className="text-sm text-neutral-500 dark:text-neutral-400">% 顯示此色</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={redColor}
            onChange={(e) => setRedColor(e.target.value)}
            className="h-8 w-8 shrink-0 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600"
          />
          {/* Same boundary as the yellow row above — 低於 X 是黃色、X 以上是
              紅色 — so editing it here moves that one threshold, and both
              fields always agree. */}
          <span className="w-16 shrink-0" />
          <input
            type="number"
            value={yellowMax}
            onChange={(e) => setYellowMax(Number(e.target.value))}
            className="w-20 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <span className="text-sm text-neutral-500 dark:text-neutral-400">% 以上顯示此色</span>
        </div>
      </div>
      <button
        type="button"
        disabled={submitting}
        onClick={handleSave}
        className="mt-4 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? "儲存中..." : "儲存"}
      </button>
    </Modal>
  );
}
