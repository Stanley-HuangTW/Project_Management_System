"use client";

import { formatMoney } from "@/lib/cost";
import type { BudgetForecast } from "@/lib/budgetForecast";
import { HScrollPane } from "@/components/ui/HScrollPane";

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 60 };

/**
 * 燒錢曲線 — 計畫、實際、含已承諾,對著核准預算那條線。
 *
 * The line that matters is 含已承諾: it is the first one to cross the budget,
 * and it crosses it while there is still time to do something. 實際 stops at
 * today, because drawing spend into the future would be a forecast, and the
 * forecast has its own numbers above the chart.
 */
export function SpendCurveChart({ forecast }: { forecast: BudgetForecast }) {
  const { points, budget } = forecast;
  if (points.length < 2) {
    return (
      <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-8 text-center text-xs text-neutral-400 dark:text-neutral-500">
        還沒有足夠的支出紀錄可以畫曲線。
      </p>
    );
  }

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const lastIndex = points.length - 1;

  // The ceiling has to clear the budget line too, or an overrun runs off the
  // top of the chart — which is exactly the case worth seeing.
  const maxValue = Math.max(
    budget,
    ...points.map((p) => Math.max(p.committed, p.actual ?? 0, p.planned ?? 0))
  );
  const ceiling = maxValue > 0 ? maxValue * 1.1 : 1;

  const x = (i: number) => PAD.left + (lastIndex === 0 ? plotWidth / 2 : (i / lastIndex) * plotWidth);
  const y = (value: number) => PAD.top + plotHeight - (value / ceiling) * plotHeight;

  function pathFor(pick: (p: (typeof points)[number]) => number | null): string {
    const segments: string[] = [];
    let open = false;
    points.forEach((point, i) => {
      const value = pick(point);
      if (value === null) {
        open = false;
        return;
      }
      segments.push(`${open ? "L" : "M"} ${x(i).toFixed(1)} ${y(value).toFixed(1)}`);
      open = true;
    });
    return segments.join(" ");
  }

  const labelStep = Math.max(1, Math.ceil(points.length / 8));
  const budgetY = y(budget);
  // Where the committed line first goes past the approved figure.
  const breachIndex = budget > 0 ? points.findIndex((p) => p.committed > budget) : -1;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-600 dark:text-neutral-300">
        <Legend color="#9ca3af" dash label="計畫(核准預算依排程攤提)" />
        <Legend color="#00c875" label="實際支出" />
        <Legend color="#e2445c" label="含已下單" />
        <Legend color="#111827" dash label="核准預算" />
      </div>

      <HScrollPane className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2">
        <svg width={WIDTH} height={HEIGHT} role="img" aria-label="燒錢曲線">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const value = ceiling * fraction;
            return (
              <g key={fraction}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="currentColor"
                  className="text-neutral-200 dark:text-neutral-700"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6}
                  y={y(value) + 3}
                  textAnchor="end"
                  className="fill-neutral-400 dark:fill-neutral-500"
                  style={{ fontSize: 9 }}
                >
                  {formatMoney(value)}
                </text>
              </g>
            );
          })}

          {budget > 0 && (
            <>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={budgetY}
                y2={budgetY}
                stroke="#111827"
                strokeWidth={1.5}
                strokeDasharray="6 3"
              />
              <text
                x={WIDTH - PAD.right}
                y={budgetY - 4}
                textAnchor="end"
                className="fill-neutral-700 dark:fill-neutral-200"
                style={{ fontSize: 9 }}
              >
                核准 {formatMoney(budget)}
              </text>
            </>
          )}

          <path d={pathFor((p) => p.planned)} fill="none" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="4 3" />
          <path d={pathFor((p) => p.committed)} fill="none" stroke="#e2445c" strokeWidth={1.5} />
          <path d={pathFor((p) => p.actual)} fill="none" stroke="#00c875" strokeWidth={2} />

          {breachIndex >= 0 && (
            <circle cx={x(breachIndex)} cy={y(points[breachIndex].committed)} r={3.5} fill="#e2445c" />
          )}

          {points.map((point, i) =>
            i % labelStep === 0 || i === lastIndex ? (
              <text
                key={point.iso}
                x={x(i)}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-neutral-400 dark:fill-neutral-500"
                style={{ fontSize: 9 }}
              >
                {point.iso.slice(5)}
              </text>
            ) : null
          )}
        </svg>
      </HScrollPane>

      {breachIndex >= 0 && (
        <p className="text-xs text-red-600">
          照目前已下單的排程,<b>{points[breachIndex].iso}</b> 前後就會用完核准預算。
        </p>
      )}
    </div>
  );
}

function Legend({ color, label, dash }: { color: string; label: string; dash?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <svg width={18} height={6} aria-hidden>
        <line
          x1={0}
          x2={18}
          y1={3}
          y2={3}
          stroke={color}
          strokeWidth={2}
          strokeDasharray={dash ? "4 3" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}
