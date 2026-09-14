import Link from "next/link";
import { AlertTriangle, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/cost";
import type { BudgetAlert } from "@/lib/budgetAlerts";

/**
 * 預算警示 — the budgets already past their line, on the page people open
 * anyway.
 *
 * Nobody opens a budget page until they already suspect something is wrong,
 * by which time the POs are signed. A card here is the only part of this that
 * reaches somebody before the money does.
 *
 * Renders nothing when every budget is comfortable: an always-present card
 * saying "all fine" is a card people stop reading.
 */
export function BudgetAlertCard({ alerts }: { alerts: BudgetAlert[] }) {
  if (alerts.length === 0) return null;

  const over = alerts.filter((a) => a.level === "over").length;

  return (
    <section className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          <Wallet size={14} /> 預算警示
        </h2>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          {over > 0 ? `${over} 項已超支` : `${alerts.length} 項接近上限`}
        </span>
      </div>

      <ul className="space-y-2">
        {alerts.map((alert) => (
          <li
            key={alert.href + alert.scopeName}
            className={`rounded-md border p-2.5 ${
              alert.level === "over"
                ? "border-red-200 dark:border-red-900"
                : "border-amber-200 dark:border-amber-900"
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <AlertTriangle
                size={13}
                className={`shrink-0 ${alert.level === "over" ? "text-red-500" : "text-amber-500"}`}
              />
              <Link
                href={alert.href}
                className="text-sm font-medium text-neutral-800 dark:text-neutral-100 hover:text-blue-600"
              >
                {alert.scopeName}
              </Link>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                {alert.scopeKind}
                {alert.boardName && ` · ${alert.boardName}`}
              </span>
              <span
                className={`text-xs font-semibold ${
                  alert.level === "over" ? "text-red-600" : "text-amber-600"
                }`}
              >
                {alert.level === "over"
                  ? `超支 ${formatMoney(Math.abs(alert.remaining))} 元`
                  : `已用 ${alert.usedPct?.toFixed(0)}%`}
              </span>
            </div>
            <p className="mt-1 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
              核准 {formatMoney(alert.budget)} · 已花費 {formatMoney(alert.actual)} · 已下單{" "}
              {formatMoney(alert.committed)} · 剩餘 {formatMoney(alert.remaining)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
