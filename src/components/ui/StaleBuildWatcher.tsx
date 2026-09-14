"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";

/**
 * Catches the "this tab is running the previous deployment" failure wherever
 * it surfaces and says so in words somebody can act on.
 *
 * Listens for unhandled rejections because most Server Action calls in this
 * app are fired from event handlers without a catch — the ones that do catch
 * use isStaleBuildError directly.
 */
export function StaleBuildWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    function onRejection(event: PromiseRejectionEvent) {
      if (!isStaleBuildError(event.reason)) return;
      // Handled: the banner replaces the console noise and the silent no-op.
      event.preventDefault();
      setStale(true);
    }
    function onError(event: ErrorEvent) {
      if (isStaleBuildError(event.error ?? event.message)) setStale(true);
    }
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  if (!stale) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex justify-center p-4">
      <div className="flex max-w-xl items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 shadow-lg dark:border-amber-700 dark:bg-amber-950">
        <RefreshCw size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">需要重新整理</p>
          <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">
            {STALE_BUILD_MESSAGE}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
        >
          重新整理
        </button>
      </div>
    </div>
  );
}
