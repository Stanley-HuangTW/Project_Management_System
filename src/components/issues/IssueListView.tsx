"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ISSUE_KIND_LABELS, ISSUE_PRIORITY_LABELS, ISSUE_STATUS_LABELS } from "@/lib/issueCase";
import type { IssueOptionDto } from "@/lib/issueOptions";
import type { IssueCaseRow, IssueFilters, IssueStatus, IssueUserDto } from "@/lib/issueTypes";
import { PriorityBadge, StatusBadge, buttonClass, inputClass, primaryButtonClass } from "./issueUi";

const STATUS_ORDER: IssueStatus[] = ["OPEN", "TC", "PC", "NA"];

type Result = { rows: IssueCaseRow[]; total: number; page: number; pageSize: number };

/** 案件列表:篩選條件全部寫在網址上(可分享、可回上一頁),改條件就換網址。 */
export function IssueListView({
  result,
  filters,
  options,
  users,
}: {
  result: Result;
  filters: IssueFilters;
  options: IssueOptionDto[];
  users: IssueUserDto[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");

  function go(patch: Record<string, string | undefined>) {
    const cur: Record<string, string | undefined> = {
      q: filters.q,
      status: filters.statuses?.join(","),
      kind: filters.kind || undefined,
      priority: filters.priority || undefined,
      product: filters.productId,
      customer: filters.customerId,
      error: filters.errorTypeId,
      unit: filters.unitId,
      assignee: filters.assigneeId,
      unassigned: filters.unassigned ? "1" : undefined,
      mine: filters.mine ? "1" : undefined,
      from: filters.from,
      to: filters.to,
      page: undefined,
    };
    const next = { ...cur, ...patch };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const qs = params.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  const opt = (kind: IssueOptionDto["kind"], selected?: string) =>
    options.filter((o) => o.kind === kind && (o.active || o.id === selected)).map((o) => ({ value: o.id, label: o.name }));

  const toggleStatus = (s: IssueStatus) => {
    const cur = new Set(filters.statuses ?? []);
    if (cur.has(s)) cur.delete(s);
    else cur.add(s);
    go({ status: STATUS_ORDER.filter((x) => cur.has(x)).join(",") || undefined });
  };

  const hasFilters = !!(
    filters.q || filters.statuses?.length || filters.kind || filters.priority || filters.productId || filters.customerId || filters.errorTypeId ||
    filters.unitId || filters.assigneeId || filters.unassigned || filters.mine || filters.from || filters.to
  );
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const selectClass = "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500";

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">案件列表</h1>
        <Link href="/issues/new" className={`${primaryButtonClass} flex items-center gap-1.5`} data-testid="new-issue">
          <Plus size={14} /> 回報新案件
        </Link>
      </div>

      <div className="mb-3 space-y-2 rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900" data-testid="issue-filters" data-issue-filters>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() || undefined });
          }}
        >
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋案件編號、客戶、QR code、描述、時間軸內容…" className={`${inputClass} pl-8`} />
          </div>
          <button type="submit" className={buttonClass}>搜尋</button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-600">
            {STATUS_ORDER.map((s) => {
              const on = filters.statuses?.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  className={`px-2.5 py-1.5 text-xs ${on ? "bg-blue-600 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"}`}
                >
                  {ISSUE_STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>
          <select value={filters.kind ?? ""} onChange={(e) => go({ kind: e.target.value || undefined })} className={selectClass} aria-label="類型">
            <option value="">類型:全部</option>
            {Object.entries(ISSUE_KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <select value={filters.priority ?? ""} onChange={(e) => go({ priority: e.target.value || undefined })} className={selectClass} aria-label="優先級">
            <option value="">優先級:全部</option>
            {Object.entries(ISSUE_PRIORITY_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <SearchableSelect options={opt("PRODUCT", filters.productId)} value={filters.productId ?? ""} onChange={(v) => go({ product: v || undefined })} emptyLabel="產品:全部" placeholder="產品:全部" className={selectClass} />
          <SearchableSelect options={opt("CUSTOMER", filters.customerId)} value={filters.customerId ?? ""} onChange={(v) => go({ customer: v || undefined })} emptyLabel="客戶:全部" placeholder="客戶:全部" className={selectClass} />
          <SearchableSelect options={opt("ERROR_TYPE", filters.errorTypeId)} value={filters.errorTypeId ?? ""} onChange={(v) => go({ error: v || undefined })} emptyLabel="問題類型:全部" placeholder="問題類型:全部" className={selectClass} />
          <SearchableSelect options={opt("HANDLER_UNIT", filters.unitId)} value={filters.unitId ?? ""} onChange={(v) => go({ unit: v || undefined })} emptyLabel="處理單位:全部" placeholder="處理單位:全部" className={selectClass} />
          <SearchableSelect options={users.map((u) => ({ value: u.id, label: u.name }))} value={filters.assigneeId ?? ""} onChange={(v) => go({ assignee: v || undefined, unassigned: undefined })} emptyLabel="負責人:全部" placeholder="負責人:全部" className={selectClass} />
          <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" checked={!!filters.unassigned} onChange={(e) => go({ unassigned: e.target.checked ? "1" : undefined, assignee: undefined })} />
            待指派
          </label>
          <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" checked={!!filters.mine} onChange={(e) => go({ mine: e.target.checked ? "1" : undefined })} />
            我的案件
          </label>
          <span className="flex items-center gap-1 text-xs text-neutral-500">
            發生日
            <input type="date" value={filters.from ?? ""} onChange={(e) => go({ from: e.target.value || undefined })} className={selectClass} />
            ~
            <input type="date" value={filters.to ?? ""} onChange={(e) => go({ to: e.target.value || undefined })} className={selectClass} />
          </span>
          {hasFilters && (
            <button type="button" onClick={() => { setQ(""); start(() => router.push(pathname)); }} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-100">
              <X size={12} /> 清除篩選
            </button>
          )}
        </div>
      </div>

      <div className={`overflow-x-auto rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900 ${pending ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[960px] text-sm" data-testid="issue-table">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs font-medium text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              <th className="px-3 py-2">案件編號</th>
              <th className="px-3 py-2">優先級</th>
              <th className="px-3 py-2">發生日</th>
              <th className="px-3 py-2">客戶</th>
              <th className="px-3 py-2">產品</th>
              <th className="px-3 py-2">問題類型</th>
              <th className="px-3 py-2">負責人 / 單位</th>
              <th className="px-3 py-2">狀態</th>
              <th className="px-3 py-2 text-right">處理天數</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60">
                <td className="whitespace-nowrap px-3 py-2">
                  <Link href={`/issues/${r.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400" data-testid="case-link">{r.caseNo}</Link>
                  <span className="ml-1.5 text-[10px] text-neutral-400">{r.kind === "REPAIR" ? "維修" : "問題"}{r.rma ? " · RMA" : ""}</span>
                </td>
                <td className="px-3 py-2"><PriorityBadge priority={r.priority} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-600 dark:text-neutral-300">{r.issueDate}</td>
                <td className="px-3 py-2">{r.customer ?? <span className="text-neutral-400">—</span>}</td>
                <td className="px-3 py-2">{r.product ?? <span className="text-neutral-400">—</span>}</td>
                <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{r.errorType ?? <span className="text-neutral-400">未判定</span>}</td>
                <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                  {r.assignees.length ? r.assignees.map((a) => a.name).join("、") : <span className="text-amber-600">待指派</span>}
                  {r.units.length > 0 && <span className="ml-1 text-xs text-neutral-400">({r.units.join("/")})</span>}
                </td>
                <td className="px-3 py-2"><StatusBadge status={r.status} locked={r.locked} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-neutral-600 dark:text-neutral-300">
                  {r.days !== null ? `${r.days} 天` : r.openDays !== null ? <span className="text-amber-600">已開 {r.openDays} 天</span> : "—"}
                </td>
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-neutral-400">
                  {hasFilters ? "沒有符合條件的案件" : "還沒有案件。點右上角「回報新案件」開始。"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <span>共 {result.total} 件</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <button type="button" disabled={result.page <= 1} onClick={() => go({ page: String(result.page - 1) })} className={buttonClass}>上一頁</button>
            <span>{result.page} / {pages}</span>
            <button type="button" disabled={result.page >= pages} onClick={() => go({ page: String(result.page + 1) })} className={buttonClass}>下一頁</button>
          </div>
        )}
      </div>
    </div>
  );
}
