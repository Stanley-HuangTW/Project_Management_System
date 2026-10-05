"use client";

import { useState } from "react";
import { MyWeekLog } from "./MyWeekLog";
import { TimesheetStatsView } from "./TimesheetStatsView";

type Tab = "mine" | "stats";

/** 工時頁:登記(按週)跟統計兩個分頁。today 由 server 算好傳進來。 */
export function TimesheetPage({ today }: { today: string }) {
  const [tab, setTab] = useState<Tab>("mine");

  return (
    <div>
      <div className="mb-4 flex w-fit overflow-hidden rounded-md border border-neutral-200 text-sm dark:border-neutral-700">
        {(
          [
            ["mine", "我的工時"],
            ["stats", "統計"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 ${
              tab === key
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "bg-white text-neutral-600 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "mine" ? <MyWeekLog today={today} /> : <TimesheetStatsView today={today} />}
    </div>
  );
}
