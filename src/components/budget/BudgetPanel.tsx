"use client";

import { useCallback, useEffect, useState } from "react";
import type { CostCategory, ReserveKind } from "@prisma/client";
import { AlertTriangle, Plus, Trash2, Check, Paperclip, X } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { formatMoney } from "@/lib/cost";
import { CATEGORY_LABELS, COST_CATEGORIES } from "@/lib/budget";
import { BASE_CURRENCY, describeForeign, isBaseCurrency } from "@/lib/currency";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { SpendCurveChart } from "./SpendCurveChart";
import {
  getBudgetView,
  setBudget,
  addCommitment,
  settleCommitment,
  deleteCommitment,
  addExpense,
  deleteExpense,
  uploadBudgetAttachment,
  deleteBudgetAttachment,
  setReserve,
  drawFromReserve,
  type BudgetScope,
  type BudgetView,
  type AttachmentRow,
} from "@/lib/actions/budget";
import { HScrollPane } from "@/components/ui/HScrollPane";

/**
 * 預算管控 — 核准多少、花掉多少、承諾出去多少、還剩多少。
 *
 * The same panel serves a phase (分組) and a whole 專案群組; only the scope
 * differs. The ledger always sits on the phase, so the programme view is the
 * sum of its phases and the two can never disagree.
 *
 * The number people come here for is 剩餘可用, and it subtracts committed
 * money as well as spent money. A PO that has been signed is gone; a remaining
 * figure that ignores it reads comfortable right up until the invoices land.
 */
export function BudgetPanel({ scope }: { scope: BudgetScope }) {
  const { notify, confirm, prompt } = useDialogs();
  const [view, setView] = useState<BudgetView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<
    "summary" | "reserve" | "forecast" | "commitments" | "expenses"
  >("summary");

  const reload = useCallback(async () => setView(await getBudgetView(scope)), [scope]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getBudgetView(scope);
      if (cancelled) return;
      setView(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return false;
      }
      await reload();
      return true;
    } catch (err) {
      // A page left open across a deploy calls a Server Action id the server
      // no longer has. That is not a budget error and should not read like one.
      await notify(isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗", {
        title: isStaleBuildError(err) ? "需要重新整理" : failTitle,
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!view) return null;

  const { summary } = view;
  const open = view.commitments.filter((c) => !c.settled);

  return (
    <div className="space-y-4">
      {view.alert !== "none" && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            view.alert === "over"
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
              : view.alert === "reserve"
                ? "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200"
                : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          }`}
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            {view.alert === "over" ? (
              <p>
                <b>已超支</b>——{view.scopeName} 核准 {formatMoney(summary.total.budget)} 元,已花費與已承諾
                合計 {formatMoney(summary.total.actual + summary.total.committed)} 元,超出{" "}
                <b>{formatMoney(Math.abs(summary.total.remaining))} 元</b>
                {view.reserves.totalRemaining > 0 &&
                  `,準備金只剩 ${formatMoney(view.reserves.totalRemaining)} 元,補不上這個缺口`}
                。
              </p>
            ) : view.alert === "reserve" ? (
              <p>
                <b>已超出成本基準,但準備金還蓋得住</b>——超出{" "}
                {formatMoney(Math.abs(summary.total.remaining))} 元,準備金餘額{" "}
                {formatMoney(view.reserves.totalRemaining)} 元。要動用的話請到「準備金」分頁動支,
                理由會一起記下來。
              </p>
            ) : (
              <p>
                預算已用掉 <b>{summary.total.usedPct?.toFixed(0)}%</b>(含已下單未入帳),剩餘{" "}
                {formatMoney(summary.total.remaining)} 元。
              </p>
            )}
            {summary.unbudgetedCategories.length > 0 && (
              <p className="mt-1 text-xs">
                另外有沒編預算就在花的類別:
                {summary.unbudgetedCategories.map((c) => CATEGORY_LABELS[c]).join("、")}。
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="核准預算" value={formatMoney(summary.total.budget)} />
        <Tile
          label="已花費"
          value={formatMoney(summary.total.actual)}
          hint={`其中人力 ${formatMoney(view.labourActual)}(由核准工時算出)`}
        />
        <Tile
          label="已下單未入帳"
          value={formatMoney(summary.total.committed)}
          hint={`${open.length} 張未入帳`}
        />
        <Tile
          label="剩餘可用"
          value={formatMoney(summary.total.remaining)}
          tone={summary.total.remaining < 0 ? "bad" : "good"}
          hint="核准 − 已花費 − 已下單"
        />
      </div>

      {view.fxExposure.byCurrency.length > 0 && view.fxExposure.total !== 0 && (
        <div
          className={`rounded-lg border p-3 text-xs ${
            view.fxExposure.total > 0
              ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              : "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200"
          }`}
        >
          <p className="font-medium">
            匯率風險:未入帳的外幣訂單若今天全部付款,會
            {view.fxExposure.total > 0 ? "多付" : "少付"}{" "}
            <b>{formatMoney(Math.abs(view.fxExposure.total))} 元</b>
          </p>
          <ul className="mt-1 space-y-0.5">
            {view.fxExposure.byCurrency.map((row) => (
              <li key={row.currency} className="tabular-nums">
                {row.currency} {row.original.toLocaleString("zh-TW")}:下單時記{" "}
                {formatMoney(row.bookedTwd)} 元,今天的匯率是 {formatMoney(row.atTodayTwd)} 元(
                {row.delta > 0 ? "+" : ""}
                {formatMoney(row.delta)})
              </li>
            ))}
          </ul>
          <p className="mt-1 opacity-80">
            這個數字不會自己進帳——每一筆仍然用它下單當下的匯率。它是提醒,不是調整。
          </p>
        </div>
      )}

      <div className="flex items-center gap-1">
        {(
          [
            ["summary", "各類別"],
            ["reserve", "準備金"],
            ["forecast", "完工預估"],
            ["commitments", `已下單 (${open.length})`],
            ["expenses", `支出明細 (${view.expenses.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded px-2.5 py-1 text-xs ${
              tab === id
                ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <CategoryTable view={view} scope={scope} busy={busy} run={run} prompt={prompt} />
      )}
      {tab === "reserve" && (
        <ReservePanel view={view} scope={scope} busy={busy} run={run} prompt={prompt} />
      )}
      {tab === "forecast" && <ForecastPanel view={view} />}
      {tab === "commitments" && (
        <CommitmentTable
          view={view}
          scope={scope}
          busy={busy}
          run={run}
          confirm={confirm}
          prompt={prompt}
        />
      )}
      {tab === "expenses" && (
        <ExpenseTable view={view} scope={scope} busy={busy} run={run} confirm={confirm} />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2">
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          tone === "bad"
            ? "text-red-600"
            : tone === "good"
              ? "text-green-600"
              : "text-neutral-900 dark:text-neutral-100"
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-[10px] text-neutral-400 dark:text-neutral-500">{hint}</p>}
    </div>
  );
}

const RESERVE_LABELS: Record<ReserveKind, string> = {
  CONTINGENCY: "應變準備金",
  MANAGEMENT: "管理準備金",
};

const RESERVE_HINTS: Record<ReserveKind, string> = {
  CONTINGENCY: "留給已經知道有風險、只是不確定會不會發生的事",
  MANAGEMENT: "留給想都沒想到的事,通常要更高層才動得了",
};

/**
 * 準備金 — 成本基準之外的緩衝,以及它被動用的紀錄。
 *
 * 動支不是加預算:撥出去的同時,那個類別的核准預算會增加同一個金額,專案的
 * 總額不變。所以這一頁真正的用處是「當初編了多少緩衝、為什麼用掉」——下一個
 * 專案要抓幾 % 的準備金,唯一的依據就是這些紀錄。
 */
function ReservePanel({
  view,
  scope,
  busy,
  run,
  prompt,
}: {
  view: BudgetView;
  scope: BudgetScope;
  busy: boolean;
  run: Runner;
  prompt: Prompt;
}) {
  const { reserves } = view;

  async function edit(kind: ReserveKind, current: number) {
    const answer = await prompt(`${RESERVE_LABELS[kind]}要編列多少?輸入 0 可以取消。`, {
      title: `設定${RESERVE_LABELS[kind]}`,
      defaultValue: current > 0 ? String(current) : "",
      numeric: true,
    });
    if (answer === null) return;
    if (answer.trim() === "") return;
    const amount = Number(answer);
    if (!Number.isFinite(amount) || amount < 0) return;
    await run(() => setReserve(scope, kind, amount, ""), "無法設定準備金");
  }

  async function draw(kind: ReserveKind) {
    const raw = await prompt(`從${RESERVE_LABELS[kind]}動支多少?`, {
      title: `動支${RESERVE_LABELS[kind]}`,
      placeholder: "金額",
      numeric: true,
      required: true,
    });
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const categories = COST_CATEGORIES.map((c, i) => `${i + 1}. ${CATEGORY_LABELS[c]}`).join("\n");
    const pick = await prompt(`撥給哪一個類別?輸入編號。\n\n${categories}`, {
      title: "動支到哪個類別",
      placeholder: "類別編號",
      numeric: true,
      required: true,
    });
    if (pick === null) return;
    const index = Number(pick.trim());
    if (!Number.isInteger(index) || index < 1 || index > COST_CATEGORIES.length) return;

    const reason = await prompt("為什麼要動用準備金?這是之後唯一查得到的紀錄。", {
      title: "動支理由",
      required: true,
      confirmLabel: "動支",
    });
    if (reason === null) return;

    await run(
      () => drawFromReserve(scope, kind, COST_CATEGORIES[index - 1], amount, reason),
      "無法動支"
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        準備金不是可以直接花的類別——要先<b>動支</b>撥進某個費用類別才花得出去。撥款時該類別的核准
        預算會加上同一個金額,所以<b>專案總額不變</b>,動支是搬錢不是生錢。
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(["CONTINGENCY", "MANAGEMENT"] as ReserveKind[]).map((kind) => {
          const line = kind === "CONTINGENCY" ? reserves.contingency : reserves.management;
          return (
            <div
              key={kind}
              className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2"
            >
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {RESERVE_LABELS[kind]}
              </p>
              <p className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {formatMoney(line.remaining)}
              </p>
              <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
                核准 {formatMoney(line.approved)} · 已動支 {formatMoney(line.drawn)}
              </p>
              <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                {RESERVE_HINTS[kind]}
              </p>
              {view.canEdit && (
                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => edit(kind, line.approved)}
                    className="rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40"
                  >
                    設定額度
                  </button>
                  <button
                    type="button"
                    disabled={busy || line.remaining <= 0}
                    onClick={() => draw(kind)}
                    className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    動支
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">總可用</p>
          <p className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
            {formatMoney(view.summary.total.remaining + reserves.totalRemaining)}
          </p>
          <p className="text-[10px] text-neutral-400 dark:text-neutral-500">
            剩餘可用 {formatMoney(view.summary.total.remaining)} + 準備金餘額{" "}
            {formatMoney(reserves.totalRemaining)}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">動支紀錄</p>
        {view.draws.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-6 text-center text-xs text-neutral-400 dark:text-neutral-500">
            還沒有動支過。
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
            {view.draws.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2 text-xs">
                <span className="w-20 shrink-0 tabular-nums text-neutral-400 dark:text-neutral-500">
                  {d.createdAt.slice(0, 10)}
                </span>
                <span className="shrink-0 text-neutral-600 dark:text-neutral-300">
                  {RESERVE_LABELS[d.kind]}
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums font-medium">
                  {formatMoney(d.amount)}
                </span>
                <span className="shrink-0 text-neutral-500 dark:text-neutral-400">
                  → {CATEGORY_LABELS[d.category]}
                </span>
                <span className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-200">
                  {d.reason}
                </span>
                <span className="shrink-0 text-neutral-400 dark:text-neutral-500">
                  {d.decidedByName}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * 完工預估 — 照這樣下去會花多少。
 *
 * 剩餘可用 is subtraction and only turns negative once the money is gone.
 * These two numbers turn negative while there is still time: a phase 40% done
 * that has spent 60% of its budget is already finished as a number, whatever
 * the remaining balance says.
 */
function ForecastPanel({ view }: { view: BudgetView }) {
  const { forecast } = view;

  if (forecast.noForecast) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 p-4 text-xs text-neutral-500 dark:text-neutral-400">
          還無法預估。需要兩樣東西:<b>核准預算</b>,以及工作項上的 <b>% Done 進度</b>
          ——沒有進度就沒有「做到哪裡」,也就沒有東西可以外推。
        </p>
        <SpendCurveChart forecast={forecast} />
      </div>
    );
  }

  const over = (forecast.varianceAtCompletion ?? 0) < 0;

  return (
    <div className="space-y-3">
      {over && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p>
            <b>預計會超支</b>——目前完成 {((forecast.fractionDone ?? 0) * 100).toFixed(0)}%,已投入{" "}
            {formatMoney(forecast.engaged)} 元。照這個效率跑完要{" "}
            <b>{formatMoney(forecast.eacAtCurrentRate!)} 元</b>,比核准的多{" "}
            {formatMoney(Math.abs(forecast.varianceAtCompletion!))} 元。
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="完成比例"
          value={forecast.fractionDone === null ? "—" : `${(forecast.fractionDone * 100).toFixed(0)}%`}
          hint="依工作天加權,只算葉節點"
        />
        <Tile label="已投入" value={formatMoney(forecast.engaged)} hint="已花費 + 已下單" />
        <Tile
          label="完工預估(照目前效率)"
          value={forecast.eacAtCurrentRate === null ? "—" : formatMoney(forecast.eacAtCurrentRate)}
          tone={over ? "bad" : "good"}
          hint="剩下的照目前單位成本算"
        />
        <Tile
          label="完工差異"
          value={
            forecast.varianceAtCompletion === null ? "—" : formatMoney(forecast.varianceAtCompletion)
          }
          tone={over ? "bad" : "good"}
          hint="核准 − 完工預估,負值代表會超支"
        />
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        另一種算法:剩下的工作若照原預算走,總共會是{" "}
        <b>
          {forecast.eacRemainingAtPlan === null ? "—" : formatMoney(forecast.eacRemainingAtPlan)} 元
        </b>
        。這是樂觀版——它假設目前為止出過的問題不會再出現。兩個數字一起看才是誠實的區間。
      </p>

      <SpendCurveChart forecast={forecast} />
    </div>
  );
}

/**
 * 幣別與匯率的輸入。
 *
 * The rate box only appears for a foreign currency, pre-filled from the rate
 * table but editable — the rate that matters is the one on the day this order
 * was placed, not today's, and the quote usually states it.
 */
function CurrencyFields({
  rates,
  currency,
  onCurrency,
  fxRate,
  onFxRate,
  amount,
}: {
  rates: { code: string; rate: number }[];
  currency: string;
  onCurrency: (code: string, suggested: number) => void;
  fxRate: string;
  onFxRate: (value: string) => void;
  amount: string;
}) {
  const foreign = !isBaseCurrency(currency);
  const converted = foreign ? Number(amount.replace(/[,s]/g, "")) * Number(fxRate) : null;

  return (
    <>
      <select
        value={currency}
        onChange={(e) => {
          const code = e.target.value;
          onCurrency(code, rates.find((r) => r.code === code)?.rate ?? 1);
        }}
        className={fieldClass}
      >
        <option value={BASE_CURRENCY}>{BASE_CURRENCY}</option>
        {rates.map((r) => (
          <option key={r.code} value={r.code}>
            {r.code}
          </option>
        ))}
      </select>
      {foreign && (
        <>
          <input
            value={fxRate}
            onChange={(e) => onFxRate(e.target.value)}
            placeholder="匯率"
            title="下單當下的匯率,會跟著這筆一起存下來"
            className={`${fieldClass} w-20 tabular-nums`}
          />
          <span className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
            ={" "}
            {Number.isFinite(converted) && converted !== null && converted > 0
              ? `${formatMoney(converted)} 元`
              : "—"}
          </span>
        </>
      )}
    </>
  );
}

/**
 * 這個範圍沒有可以記帳的工作項。
 *
 * 只有未對應的預算階段會走到這裡:預算編得出來,但訂單與支出是記在看板上
 * 真的那一列底下的,沒有那一列就無處可記。
 */
function NoLedgerTargetNote() {
  return (
    <p className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      這個階段還沒有對應到看板上的工作項,所以沒有地方可以記帳。到「人力表」編輯這個階段,把
      「對應看板階段」設定好之後就可以在這裡登記。
    </p>
  );
}

const fieldClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500";

type Runner = (work: () => Promise<{ error?: string }>, failTitle: string) => Promise<boolean>;
/** Passed down rather than taken from the hook inside each sub-panel: a bare
 *  `prompt` in a component resolves to window.prompt, which this app's
 *  embedded browser ignores — the same reason DialogProvider exists at all. */
type Prompt = ReturnType<typeof useDialogs>["prompt"];

/**
 * 憑證 attached to one expense or PO — the quote, the invoice, the signed
 * order. Opened through the same authorised route as every other attachment.
 */
function Attachments({
  scope,
  attachments,
  target,
  canEdit,
  busy,
  run,
}: {
  scope: BudgetScope;
  attachments: AttachmentRow[];
  target: { expenseId?: string; commitmentId?: string };
  canEdit: boolean;
  busy: boolean;
  run: Runner;
}) {
  const inputId = `att-${target.expenseId ?? target.commitmentId}`;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {attachments.map((file) => (
        <span
          key={file.id}
          className="flex items-center gap-0.5 rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[11px]"
        >
          <a
            href={`/api/attachments/${file.id}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-0.5 text-blue-600 hover:underline dark:text-blue-400"
            title={`${Math.round(file.size / 1024)} KB`}
          >
            <Paperclip size={10} />
            <span className="max-w-[9rem] truncate">{file.fileName}</span>
          </a>
          {canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => deleteBudgetAttachment(scope, file.id), "無法刪除檔案")}
              className="text-neutral-400 hover:text-red-600 disabled:opacity-40"
              aria-label={`刪除 ${file.fileName}`}
            >
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <>
          <input
            id={inputId}
            type="file"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.append("file", file);
              await run(() => uploadBudgetAttachment(scope, target, form), "無法上傳檔案");
              // Cleared so picking the same file twice still fires onChange.
              e.target.value = "";
            }}
          />
          <label
            htmlFor={inputId}
            className="cursor-pointer rounded border border-dashed border-neutral-300 dark:border-neutral-600 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:text-neutral-400 hover:border-blue-400 hover:text-blue-600"
            title="附上報價單、發票或簽好的 PO"
          >
            <Paperclip size={10} className="inline" /> 附件
          </label>
        </>
      )}
    </span>
  );
}

function CategoryTable({
  view,
  scope,
  busy,
  run,
  prompt,
}: {
  view: BudgetView;
  scope: BudgetScope;
  busy: boolean;
  run: Runner;
  prompt: Prompt;
}) {
  const byCategory = new Map(view.summary.lines.map((l) => [l.category, l]));

  async function edit(category: CostCategory) {
    const current = byCategory.get(category)?.budget ?? 0;
    const answer = await prompt(`${CATEGORY_LABELS[category]}核准多少預算?輸入 0 可以取消這個類別。`, {
      title: `設定${CATEGORY_LABELS[category]}預算`,
      // Empty rather than "0" when nothing is set yet, so the box does not
      // have to be cleared before typing.
      defaultValue: current > 0 ? String(current) : "",
      numeric: true,
    });
    if (answer === null) return;
    // An empty box means "changed my mind", not "delete it". Clearing a field
    // should never be the gesture that removes an approved figure — 0 is, and
    // it has to be typed.
    if (answer.trim() === "") return;
    const amount = Number(answer);
    if (!Number.isFinite(amount) || amount < 0) return;
    await run(() => setBudget(scope, category, amount, ""), "無法儲存預算");
  }

  return (
    <HScrollPane className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
      <table className="w-full text-xs">
        <thead className="border-b border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400">
          <tr>
            <th className="px-3 py-2 text-left font-medium">類別</th>
            <th className="px-3 py-2 text-right font-medium">核准預算</th>
            <th className="px-3 py-2 text-right font-medium">已花費</th>
            <th className="px-3 py-2 text-right font-medium">已下單</th>
            <th className="px-3 py-2 text-right font-medium">剩餘</th>
            <th className="px-3 py-2 text-right font-medium">用掉</th>
            {view.canEdit && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {COST_CATEGORIES.map((category) => {
            const row = byCategory.get(category);
            if (!row && !view.canEdit) return null;
            const budget = row?.budget ?? 0;
            const actual = row?.actual ?? 0;
            const committed = row?.committed ?? 0;
            const remaining = budget - actual - committed;
            const used = budget > 0 ? ((actual + committed) / budget) * 100 : null;
            return (
              <tr key={category} className={row?.isOver ? "bg-red-50/60 dark:bg-red-950/20" : ""}>
                <td className="px-3 py-1.5 text-neutral-800 dark:text-neutral-100">
                  {CATEGORY_LABELS[category]}
                  {category === "LABOUR" && (
                    <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                      {view.labourFromPlan ? "(由人力規劃表計算)" : "(由工時自動計算)"}
                    </span>
                  )}
                  {category === "MATERIAL" && view.materialFromBom && (
                    <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                      (由樣機 BOM 計算)
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
                  {budget ? formatMoney(budget) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
                  {actual ? formatMoney(actual) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
                  {committed ? formatMoney(committed) : "—"}
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums font-medium ${
                    budget === 0 && actual + committed === 0
                      ? "text-neutral-400 dark:text-neutral-500"
                      : remaining < 0
                        ? "text-red-600"
                        : "text-green-600"
                  }`}
                >
                  {budget === 0 && actual + committed === 0 ? "—" : formatMoney(remaining)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                  {used === null ? "—" : `${used.toFixed(0)}%`}
                </td>
                {view.canEdit && (
                  <td className="px-3 py-1.5 text-right">
                    {category === "LABOUR" && view.labourFromPlan ? (
                      <span
                        className="text-[11px] text-neutral-400 dark:text-neutral-500"
                        title="到「人力規劃」那張表改人月,或到系統設定改單位標準月薪"
                      >
                        見人力規劃
                      </span>
                    ) : category === "MATERIAL" && view.materialFromBom ? (
                      <span
                        className="text-[11px] text-neutral-400 dark:text-neutral-500"
                        title="到「樣機 BOM」那張表改單價、廠商或台數"
                      >
                        見 BOM
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => edit(category)}
                        className="rounded border border-neutral-200 dark:border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40"
                      >
                        設定
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-neutral-200 dark:border-neutral-700 font-medium">
          <tr>
            <td className="px-3 py-2 text-neutral-800 dark:text-neutral-100">合計</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(view.summary.total.budget)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(view.summary.total.actual)}</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatMoney(view.summary.total.committed)}
            </td>
            <td
              className={`px-3 py-2 text-right tabular-nums ${
                view.summary.total.remaining < 0 ? "text-red-600" : "text-green-600"
              }`}
            >
              {formatMoney(view.summary.total.remaining)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
              {view.summary.total.usedPct === null ? "—" : `${view.summary.total.usedPct.toFixed(0)}%`}
            </td>
            {view.canEdit && <td />}
          </tr>
        </tfoot>
      </table>
    </HScrollPane>
  );
}

function CommitmentTable({
  view,
  scope,
  busy,
  run,
  confirm,
  prompt,
}: {
  view: BudgetView;
  scope: BudgetScope;
  busy: boolean;
  run: Runner;
  confirm: (message: string, options?: Record<string, unknown>) => Promise<boolean>;
  prompt: Prompt;
}) {
  // Defaults to the scope's own row — a phase-level cost is the common case,
  // and picking a task is the exception rather than a required step.
  const [itemId, setItemId] = useState(view.items[0]?.id ?? "");
  const [category, setCategory] = useState<CostCategory>("MATERIAL");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(BASE_CURRENCY);
  const [fxRate, setFxRate] = useState("1");
  const [vendor, setVendor] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [expectedDate, setExpectedDate] = useState("");

  async function handleAdd() {
    const ok = await run(
      () =>
        addCommitment(scope, {
          itemId,
          category,
          amount: Number(amount.replace(/[,\s]/g, "")),
          currency,
          fxRate: Number(fxRate),
          vendor,
          poNumber,
          expectedDate: expectedDate || null,
          note: "",
        }),
      "無法新增訂單"
    );
    if (ok) {
      setAmount("");
      setVendor("");
      setPoNumber("");
      setExpectedDate("");
    }
  }

  async function handleSettle(id: string, committed: number) {
    const answer = await prompt("實際入帳金額是多少?", {
      title: "訂單入帳",
      defaultValue: String(committed),
      numeric: true,
      required: true,
    });
    if (answer === null) return;
    const value = Number(answer);
    const date = await prompt("入帳日期", {
      title: "訂單入帳",
      defaultValue: new Date().toISOString().slice(0, 10),
      placeholder: "YYYY-MM-DD",
      required: true,
    });
    if (date === null) return;
    await run(() => settleCommitment(scope, id, value, date), "無法入帳");
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        PO 一簽,錢就等於花掉了,只是發票還沒到。這裡登記之後,「剩餘可用」會先把它扣掉——
        等到入帳時按「入帳」,它就轉成一筆實際支出。
      </p>

      {view.canEdit && view.items.length === 0 && <NoLedgerTargetNote />}

      {view.canEdit && view.items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={`${fieldClass} max-w-[16rem]`}>
            {view.items.map((i) => (
              <option key={i.id} value={i.id}>
                {" ".repeat(i.depth * 2)}
                {scope.kind === "program" ? `${i.boardName} / ${i.name}` : i.name}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CostCategory)}
            className={fieldClass}
          >
            {COST_CATEGORIES.filter((c) => c !== "LABOUR").map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="金額"
            className={`${fieldClass} w-24 tabular-nums`}
          />
          <CurrencyFields
            rates={view.rates}
            currency={currency}
            onCurrency={(code, suggested) => {
              setCurrency(code);
              setFxRate(String(suggested));
            }}
            fxRate={fxRate}
            onFxRate={setFxRate}
            amount={amount}
          />
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="廠商"
            className={`${fieldClass} w-28`}
          />
          <input
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="PO 號"
            className={`${fieldClass} w-28`}
          />
          <input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            title="預計到貨／入帳日"
            className={fieldClass}
          />
          <button
            type="button"
            disabled={busy || !amount.trim() || !itemId}
            onClick={handleAdd}
            className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <Plus size={12} /> 新增
          </button>
        </div>
      )}

      {view.commitments.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-8 text-center text-xs text-neutral-400 dark:text-neutral-500">
          還沒有已下單的紀錄。
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
          {view.commitments.map((c) => (
            <li
              key={c.id}
              className={`flex flex-wrap items-center gap-2 px-3 py-2 text-xs ${
                c.settled ? "text-neutral-400 dark:text-neutral-500" : ""
              }`}
            >
              <span className="w-16 shrink-0">{CATEGORY_LABELS[c.category]}</span>
              <span className="w-24 shrink-0 text-right tabular-nums font-medium">
                {formatMoney(c.amount)}
              </span>
              {describeForeign(c) && (
                <span
                  className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] tabular-nums text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  title="下單當下的匯率,已凍結"
                >
                  {describeForeign(c)}
                </span>
              )}
              <span className="w-28 shrink-0 truncate">{c.vendor || "—"}</span>
              <span className="w-24 shrink-0 truncate text-neutral-500 dark:text-neutral-400">
                {c.poNumber}
              </span>
              <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                {c.expectedDate ?? ""}
              </span>
              <span className="shrink-0 truncate text-neutral-400 dark:text-neutral-500">{c.itemName}</span>
              <span className="basis-full" />
              <Attachments
                scope={scope}
                attachments={c.attachments}
                target={{ commitmentId: c.id }}
                canEdit={view.canEdit}
                busy={busy}
                run={run}
              />
              {c.settled ? (
                <span className="ml-auto shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">
                  已入帳
                </span>
              ) : (
                view.canEdit && (
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSettle(c.id, c.amount)}
                      className="flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-700 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40"
                    >
                      <Check size={11} /> 入帳
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await confirm(`刪除這筆 ${formatMoney(c.amount)} 元的訂單?`, {
                          title: "刪除訂單",
                          confirmLabel: "刪除",
                          danger: true,
                        });
                        if (ok) await run(() => deleteCommitment(scope, c.id), "無法刪除");
                      }}
                      className="rounded p-0.5 text-neutral-400 hover:text-red-600 disabled:opacity-40"
                      aria-label="刪除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExpenseTable({
  view,
  scope,
  busy,
  run,
  confirm,
}: {
  view: BudgetView;
  scope: BudgetScope;
  busy: boolean;
  run: Runner;
  confirm: (message: string, options?: Record<string, unknown>) => Promise<boolean>;
}) {
  const [itemId, setItemId] = useState(view.items[0]?.id ?? "");
  const [category, setCategory] = useState<CostCategory>("MATERIAL");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(BASE_CURRENCY);
  const [fxRate, setFxRate] = useState("1");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendor, setVendor] = useState("");
  const [file, setFile] = useState<File | null>(null);

  /**
   * The receipt goes up in the same action as the expense.
   *
   * An attachment needs a row to hang off, so it is two calls — but asking
   * somebody to add the expense first and come back for the 報價單 second is
   * exactly the step that never happens.
   */
  async function handleAdd() {
    const ok = await run(async () => {
      const result = await addExpense(scope, {
        itemId,
        category,
        amount: Number(amount.replace(/[,\s]/g, "")),
        currency,
        fxRate: Number(fxRate),
        date,
        vendor,
        note: "",
      });
      if (result.error || !result.id || !file) return result;
      const form = new FormData();
      form.append("file", file);
      return uploadBudgetAttachment(scope, { expenseId: result.id }, form);
    }, "無法新增支出");
    if (ok) {
      setAmount("");
      setVendor("");
      setFile(null);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        人力成本不在這裡登記——它由核准過的工時 × 時薪自動算出,再記一次就會重複計算。
      </p>

      {view.canEdit && view.items.length === 0 && <NoLedgerTargetNote />}

      {view.canEdit && view.items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={`${fieldClass} max-w-[16rem]`}>
            {view.items.map((i) => (
              <option key={i.id} value={i.id}>
                {" ".repeat(i.depth * 2)}
                {scope.kind === "program" ? `${i.boardName} / ${i.name}` : i.name}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CostCategory)}
            className={fieldClass}
          >
            {COST_CATEGORIES.filter((c) => c !== "LABOUR").map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="金額"
            className={`${fieldClass} w-24 tabular-nums`}
          />
          <CurrencyFields
            rates={view.rates}
            currency={currency}
            onCurrency={(code, suggested) => {
              setCurrency(code);
              setFxRate(String(suggested));
            }}
            fxRate={fxRate}
            onFxRate={setFxRate}
            amount={amount}
          />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="廠商／說明"
            className={`${fieldClass} w-32`}
          />
          <input
            id="new-expense-file"
            type="file"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <label
            htmlFor="new-expense-file"
            className={`flex cursor-pointer items-center gap-1 rounded border border-dashed px-2 py-1 text-xs ${
              file
                ? "border-blue-400 text-blue-600"
                : "border-neutral-300 dark:border-neutral-600 text-neutral-500 dark:text-neutral-400 hover:border-blue-400 hover:text-blue-600"
            }`}
            title="報價單、發票等憑證"
          >
            <Paperclip size={12} />
            <span className="max-w-[10rem] truncate">{file ? file.name : "附件"}</span>
          </label>
          {file && (
            <button
              type="button"
              onClick={() => setFile(null)}
              className="text-neutral-400 hover:text-red-600"
              aria-label="移除選取的檔案"
            >
              <X size={12} />
            </button>
          )}
          <button
            type="button"
            disabled={busy || !amount.trim() || !itemId}
            onClick={handleAdd}
            className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <Plus size={12} /> 新增
          </button>
        </div>
      )}

      {view.expenses.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-8 text-center text-xs text-neutral-400 dark:text-neutral-500">
          還沒有支出紀錄。
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
          {view.expenses.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
              <span className="w-20 shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                {e.date}
              </span>
              <span className="w-16 shrink-0">{CATEGORY_LABELS[e.category]}</span>
              <span className="w-24 shrink-0 text-right tabular-nums font-medium">
                {formatMoney(e.amount)}
              </span>
              {describeForeign(e) && (
                <span
                  className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] tabular-nums text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  title="記帳當下的匯率,已凍結"
                >
                  {describeForeign(e)}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{e.vendor || e.note}</span>
              <span className="shrink-0 truncate text-neutral-400 dark:text-neutral-500">{e.itemName}</span>
              <Attachments
                scope={scope}
                attachments={e.attachments}
                target={{ expenseId: e.id }}
                canEdit={view.canEdit}
                busy={busy}
                run={run}
              />
              {view.canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await confirm(`刪除這筆 ${formatMoney(e.amount)} 元的支出?`, {
                      title: "刪除支出",
                      confirmLabel: "刪除",
                      danger: true,
                    });
                    if (ok) await run(() => deleteExpense(scope, e.id), "無法刪除");
                  }}
                  className="shrink-0 rounded p-0.5 text-neutral-400 hover:text-red-600 disabled:opacity-40"
                  aria-label="刪除"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
