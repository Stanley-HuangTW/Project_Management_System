"use client";

import { useState } from "react";
import { toPercent, type ProgressCurve } from "@/lib/progressCurve";

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

const SERIES = [
  { key: "planned" as const, label: "計畫(基準線)", color: "#9ca3af", dash: "4 3" },
  { key: "scheduled" as const, label: "目前排程", color: "#579bfc", dash: undefined },
  { key: "actual" as const, label: "實際完成", color: "#00c875", dash: undefined },
];

/**
 * 進度 S 曲線 / 燃盡圖 — the same three series read two ways: cumulative done
 * (S-curve) or work still left (burn-down). They are the same numbers, but
 * people argue about schedule in one and about scope in the other.
 */
export function ProgressCurveChart({ curve }: { curve: ProgressCurve }) {
  const [mode, setMode] = useState<"scurve" | "burndown">("scurve");

  if (curve.points.length === 0) {
    return (
      <p className="text-sm text-neutral-400 dark:text-neutral-500">
        尚無可畫的日期,請先設定甘特圖的開始/天數欄位。
      </p>
    );
  }

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const lastIndex = curve.points.length - 1;

  const x = (i: number) => PAD.left + (lastIndex === 0 ? plotWidth / 2 : (i / lastIndex) * plotWidth);
  const y = (percent: number) => PAD.top + plotHeight - (percent / 100) * plotHeight;
  const valueAt = (count: number) => {
    const percent = toPercent(count, curve.total);
    return mode === "scurve" ? percent : 100 - percent;
  };

  function pathFor(key: (typeof SERIES)[number]["key"]): string {
    const segments: string[] = [];
    let open = false;
    curve.points.forEach((point, i) => {
      const count = point[key];
      // The 實際 line simply ends at today rather than dropping to zero.
      if (count === null) {
        open = false;
        return;
      }
      segments.push(`${open ? "L" : "M"} ${x(i).toFixed(1)} ${y(valueAt(count)).toFixed(1)}`);
      open = true;
    });
    return segments.join(" ");
  }

  // Enough labels to date the curve, few enough to stay readable.
  const labelStep = Math.max(1, Math.ceil(curve.points.length / 8));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 text-xs">
          <button
            type="button"
            onClick={() => setMode("scurve")}
            className={`px-2.5 py-1 ${mode === "scurve" ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400"}`}
          >
            S 曲線
          </button>
          <button
            type="button"
            onClick={() => setMode("burndown")}
            className={`px-2.5 py-1 ${mode === "burndown" ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400"}`}
          >
            燃盡圖
          </button>
        </div>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
            <svg width={16} height={8}>
              <line x1={0} y1={4} x2={16} y2={4} stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" style={{ minWidth: 480 }} role="img">
          {[0, 25, 50, 75, 100].map((percent) => (
            <g key={percent}>
              <line
                x1={PAD.left}
                y1={y(percent)}
                x2={WIDTH - PAD.right}
                y2={y(percent)}
                stroke="currentColor"
                strokeWidth={percent === 0 ? 1 : 0.5}
                className="text-neutral-200 dark:text-neutral-700"
              />
              <text
                x={PAD.left - 5}
                y={y(percent) + 3}
                textAnchor="end"
                className="fill-neutral-400 dark:fill-neutral-500"
                style={{ fontSize: 9 }}
              >
                {percent}%
              </text>
            </g>
          ))}

          {curve.points.map((point, i) =>
            i % labelStep === 0 || i === lastIndex ? (
              <text
                key={point.iso}
                x={x(i)}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-neutral-400 dark:fill-neutral-500"
                style={{ fontSize: 9 }}
              >
                {point.iso.slice(2).replace(/-/g, "/")}
              </text>
            ) : null
          )}

          {SERIES.map((s) => {
            if (s.key === "planned" && !curve.hasBaseline) return null;
            return (
              <path
                key={s.key}
                d={pathFor(s.key)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dash}
                strokeLinejoin="round"
              />
            );
          })}
        </svg>
      </div>

      <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
        以葉節點工作項數量計算,每週一點。
        {curve.hasBaseline ? "" : "尚未建立基準線,「計畫」線無法繪製——請至系統設定建立。"}
        「實際完成」以已完成工作項的結束日期認列,只畫到今天。
      </p>
    </div>
  );
}
