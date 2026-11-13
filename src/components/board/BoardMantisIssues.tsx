"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { RiskStatus } from "@prisma/client";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { HScrollPane } from "@/components/ui/HScrollPane";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { UserOption } from "@/types/board";
import { listBoardMantisIssues, type BoardMantisInfo } from "@/lib/actions/mantisIssues";
import { syncMantisNow } from "@/lib/actions/mantis";
import {
  UNASSIGNED_KEY,
  countByStatus,
  filterIssues,
  groupByHandler,
  handlerNameOf,
  sortIssues,
  type MantisIssueRow,
} from "@/lib/mantisIssues";
import { RISK_STATUS_LABELS } from "@/lib/riskRegister";
import { STATUS_CHIP_CLASS } from "./RiskWorkflow";
import { actionErrorMessage } from "@/lib/userError";
import { localeDateTimeWithWeekday, localeDateWithWeekday, withWeekday } from "@/lib/weekdayLabel";

const selectClass =
  "rounded border border-neutral-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

const formatDay = (iso: string | null) => (iso ? localeDateWithWeekday(iso) : "—");

/**
 * 看板的「問題」分頁:同步自 MantisBT 的問題。兩種看法——清單(每筆的 Mantis 資訊),
 * 與「依處理人」(每位同仁手上有哪些問題)。唯讀;要改請到 Mantis。
 */
export function BoardMantisIssues({
  boardId,
  users,
  isAdmin,
}: {
  boardId: string;
  users: UserOption[];
  isAdmin: boolean;
}) {
  const { notify } = useDialogs();
  const [data, setData] = useState<{ connection: BoardMantisInfo | null; issues: MantisIssueRow[] } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [mode, setMode] = useState<"list" | "people">("list");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | RiskStatus>("all");
  const [handler, setHandler] = useState("all");
  const [showClosed, setShowClosed] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listBoardMantisIssues(boardId);
      if (!cancelled) setData(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, refreshKey]);

  const issues = useMemo(() => data?.issues ?? [], [data]);
  const avatarOf = useMemo(() => new Map(users.map((u) => [u.id, u.avatarUrl ?? null])), [users]);
  const counts = useMemo(() => countByStatus(issues), [issues]);
  const people = useMemo(() => groupByHandler(issues), [issues]);
  const shown = useMemo(
    () => sortIssues(filterIssues(issues, { query, status, handler, showClosed })),
    [issues, query, status, handler, showClosed]
  );
  const shownPeople = useMemo(() => groupByHandler(shown), [shown]);

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await syncMantisNow(boardId);
      if (result.error) await notify(result.error, { title: "同步失敗" });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      await notify(actionErrorMessage(err, "同步失敗"), { title: "同步失敗" });
    } finally {
      setSyncing(false);
    }
  }

  if (data === null) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  const { connection } = data;

  const statusChip = (r: MantisIssueRow) => (
    <span
      className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CHIP_CLASS[r.status]}`}
      title={`歸類:${RISK_STATUS_LABELS[r.status]}`}
    >
      {r.mantisStatus ?? RISK_STATUS_LABELS[r.status]}
    </span>
  );
  const idLink = (r: MantisIssueRow) => (
    <a
      href={r.url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 whitespace-nowrap font-medium text-indigo-700 hover:underline dark:text-indigo-300"
      title="在 Mantis 開啟"
    >
      #{r.mantisId} <ExternalLink size={10} />
    </a>
  );

  return (
    <div className="space-y-4">
      {!connection ? (
        <p className="rounded-md border border-dashed border-neutral-200 py-10 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
          這個看板還沒有連到 MantisBT。管理者可以在「系統設定 → MantisBT 同步」建立連線。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-neutral-700 dark:text-neutral-200">
              Mantis 專案「{connection.projectName}」
              <a
                href={connection.baseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 inline-flex items-center gap-0.5 text-xs text-indigo-700 hover:underline dark:text-indigo-300"
              >
                {connection.baseUrl.replace(/^https?:\/\//, "")} <ExternalLink size={10} />
              </a>
            </span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {connection.lastSyncAt ? `上次同步 ${localeDateTimeWithWeekday(connection.lastSyncAt)}` : "還沒同步過"}
              {!connection.enabled && "・已停用"}
            </span>
            {connection.lastSyncError && (
              <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
                上次同步失敗:{connection.lastSyncError}
              </span>
            )}
            {isAdmin && (
              <button
                type="button"
                disabled={syncing}
                onClick={syncNow}
                className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                <RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> 立即同步
              </button>
            )}
            <div className="ml-auto flex overflow-hidden rounded-md border border-neutral-200 text-xs dark:border-neutral-700">
              {(
                [
                  ["list", "清單"],
                  ["people", "依處理人"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key)}
                  className={`px-3 py-1 ${
                    mode === key
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "bg-white text-neutral-600 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["all", `全部 ${counts.total}`],
                ["OPEN", `未處理 ${counts.open}`],
                ["MITIGATING", `處理中 ${counts.working}`],
                ["CLOSED", `已結案 ${counts.closed}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  status === key
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
                }`}
              >
                {label}
              </button>
            ))}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋標題、編號、處理人、分類…"
              className={`${selectClass} w-60`}
            />
            <select value={handler} onChange={(e) => setHandler(e.target.value)} className={selectClass} aria-label="處理人">
              <option value="all">全部處理人</option>
              {people.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}({p.open + p.working})
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
              顯示已結案
            </label>
            <span className="ml-auto text-xs text-neutral-400 dark:text-neutral-500">符合 {shown.length} 筆</span>
          </div>

          {issues.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-200 py-10 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
              還沒有同步到任何問題。
              {connection.lastSyncNote && <span className="mx-auto mt-2 block max-w-xl text-xs">{connection.lastSyncNote}</span>}
            </p>
          ) : shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">沒有符合條件的問題。</p>
          ) : mode === "list" ? (
            <HScrollPane className="rounded-md border border-neutral-200 dark:border-neutral-700">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-neutral-50 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">編號</th>
                    <th className="px-3 py-2 text-left font-medium">摘要</th>
                    <th className="px-3 py-2 text-left font-medium">狀態</th>
                    <th className="px-3 py-2 text-left font-medium">嚴重度</th>
                    <th className="px-3 py-2 text-left font-medium">優先權</th>
                    <th className="px-3 py-2 text-left font-medium">處理人</th>
                    <th className="px-3 py-2 text-left font-medium">回報人</th>
                    <th className="px-3 py-2 text-left font-medium">分類</th>
                    <th className="px-3 py-2 text-left font-medium">到期日</th>
                    <th className="px-3 py-2 text-left font-medium">更新</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
                  {shown.map((r) => (
                    <Fragment key={r.riskId}>
                      <tr
                        onClick={() => setOpenRow(openRow === r.riskId ? null : r.riskId)}
                        className={`cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 ${r.status === "CLOSED" ? "opacity-60" : ""}`}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          {idLink(r)}
                        </td>
                        <td className="max-w-[360px] px-3 py-2 text-neutral-800 dark:text-neutral-100">
                          <p className="truncate" title={r.title}>
                            {r.title}
                          </p>
                        </td>
                        <td className="px-3 py-2">{statusChip(r)}</td>
                        <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{r.severity ?? "—"}</td>
                        <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{r.priority ?? "—"}</td>
                        <td className="px-3 py-2 text-neutral-700 dark:text-neutral-200">
                          <span className="inline-flex items-center gap-1.5">
                            {r.ownerId && <Avatar name={handlerNameOf(r)} avatarUrl={avatarOf.get(r.ownerId)} size={18} />}
                            {handlerNameOf(r)}
                            {!r.ownerId && r.handlerName && (
                              <span className="text-[10px] text-neutral-400" title="在本系統找不到對應的同仁(Email 對不上)">
                                (Mantis)
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{r.reporter ?? "—"}</td>
                        <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{r.category ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-600 dark:text-neutral-300">{r.dueDate ? withWeekday(r.dueDate) : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-500 dark:text-neutral-400">{formatDay(r.updatedAt)}</td>
                      </tr>
                      {openRow === r.riskId && (
                        <tr className="bg-neutral-50 dark:bg-neutral-800/60">
                          <td colSpan={10} className="px-4 py-3 text-xs text-neutral-600 dark:text-neutral-300">
                            <p className="mb-1 text-neutral-400 dark:text-neutral-500">
                              建立於 {formatDay(r.createdAt)}・Mantis 上更新於 {r.updatedAt ? localeDateTimeWithWeekday(r.updatedAt) : "—"}
                            </p>
                            <p className="whitespace-pre-wrap break-words">{r.descriptionPreview || "(沒有說明)"}</p>
                            {r.descriptionPreview.length >= 400 && <p className="mt-1 text-neutral-400">……完整內容請在 Mantis 查看。</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </HScrollPane>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {shownPeople.map((g) => (
                <section key={g.key} className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
                  <header className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
                    {g.userId ? (
                      <Avatar name={g.name} avatarUrl={avatarOf.get(g.userId)} size={24} />
                    ) : (
                      <span className="h-6 w-6 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700" />
                    )}
                    <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{g.name}</span>
                    {!g.userId && g.key !== UNASSIGNED_KEY && (
                      <span className="text-[10px] text-neutral-400" title="在本系統找不到對應的同仁(Email 對不上)">
                        (Mantis)
                      </span>
                    )}
                    <span className="ml-auto text-xs text-neutral-500 dark:text-neutral-400">
                      未處理 {g.open}・處理中 {g.working}
                      {g.closed > 0 && `・已結案 ${g.closed}`}
                    </span>
                  </header>
                  <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {g.issues.map((r) => (
                      <li key={r.riskId} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${r.status === "CLOSED" ? "opacity-60" : ""}`}>
                        {idLink(r)}
                        <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200" title={r.title}>
                          {r.title}
                        </span>
                        {r.severity && <span className="hidden shrink-0 text-xs text-neutral-400 sm:inline">{r.severity}</span>}
                        {statusChip(r)}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
