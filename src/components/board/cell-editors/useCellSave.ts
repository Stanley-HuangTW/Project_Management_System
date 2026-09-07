"use client";

import { useRouter } from "next/navigation";
import { useDialogs } from "@/components/ui/DialogProvider";

/**
 * Runs a cell-update server action and surfaces its error instead of leaving
 * it as an unhandled rejection — the schedule locks and the summary-window
 * rule both reject writes, and without this the edit just appeared to do
 * nothing. Refreshes afterwards so the field snaps back to the stored value
 * rather than keeping the rejected one on screen.
 */
export function useCellSave() {
  const router = useRouter();
  const { notify } = useDialogs();
  return (run: () => Promise<unknown>) => {
    run()
      .then((result) => {
        // Validation comes back as a value, not an exception — Next.js
        // redacts thrown Server Action messages in production builds.
        const error =
          result && typeof result === "object" && "error" in result
            ? (result as { error?: unknown }).error
            : null;
        if (typeof error === "string") {
          notify(error, { title: "無法儲存" });
          router.refresh();
        }
      })
      .catch(() => {
        notify("儲存失敗,請重新整理後再試一次。", { title: "無法儲存" });
        router.refresh();
      });
  };
}
