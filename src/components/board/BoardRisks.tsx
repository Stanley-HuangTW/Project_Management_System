"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RiskKind, RiskStatus } from "@prisma/client";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PersonPicker } from "@/components/ui/PersonPicker";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { BoardWithData, UserOption } from "@/types/board";
import { computeWbsCodes } from "@/lib/wbs";
import { withWeekday } from "@/lib/weekdayLabel";
import { DateWeekdayHint } from "@/components/ui/DateWeekdayHint";
import { describeDueAgainstItem } from "@/lib/riskDueWindow";
import { ItemTreePicker } from "./ItemTreePicker";
import {
  riskScore,
  riskBand,
  sortRisks,
  riskKindLabel,
  RISK_KIND_LABELS,
  RISK_STATUS_LABELS,
} from "@/lib/riskRegister";
import { riskEmv, summarizeEmv, resolveProbability, PROBABILITY_BY_LEVEL } from "@/lib/riskEmv";
import { WRITE_FIELD_LABELS, type WriteField } from "@/lib/mantisMapping";
import { formatMoney } from "@/lib/cost";
import {
  listRisks,
  getRiskDetail,
  createRisk,
  updateRisk,
  setRiskStatus,
  deleteRisk,
  type RiskRow,
  type RiskInput,
  type RiskUpdateRow,
  type RiskHistoryRow,
} from "@/lib/actions/risk";
import { WORKING_STATUSES } from "@/lib/riskWorkflow";
import { ClosureBar, HistoryPanel, ReviewerEditor, STATUS_CHIP_CLASS, UpdatesPanel } from "./RiskWorkflow";
import { RiskTodosPanel } from "./RiskTodosPanel";
import { DiscussInChatButton } from "@/components/chat/DiscussInChatButton";
import { riskKindOf } from "@/lib/chatRefs";
import { HScrollPane } from "@/components/ui/HScrollPane";

const EMPTY: RiskInput = {
  kind: "RISK",
  status: "OPEN",
  title: "",
  description: "",
  probability: 3,
  impact: 3,
  costImpact: null,
  probabilityPct: null,
  mitigation: "",
  ownerId: null,
  reviewerIds: [],
  dueDate: null,
  itemId: null,
};

const TABS = [
  { key: "content", label: "內容與審核" },
  { key: "updates", label: "進度更新" },
  { key: "todos", label: "待辦事項" },
  { key: "history", label: "紀錄" },
] as const;

const LEVELS = [1, 2, 3, 4, 5];

/**
 * 風險與議題登錄簿 — the register the NUDD reviews already run on paper.
 *
 * Sorted by 機率×衝擊 with the closed entries at the bottom, so the top of
 * the list is always the thing to talk about first.
 */
export function BoardRisks({
  board,
  users,
  currentUserId,
  openRiskId = null,
}: {
  board: BoardWithData;
  users: UserOption[];
  currentUserId: string;
  /** 連結帶來的:清單讀好之後直接開這一筆(找不到就只是停在清單)。 */
  openRiskId?: string | null;
}) {
  const { notify, confirm } = useDialogs();
  const [risks, setRisks] = useState<RiskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; input: RiskInput } | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [source, setSource] = useState<"all" | "manual" | "mantis">("all");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("content");
  const [detail, setDetail] = useState<{ updates: RiskUpdateRow[]; history: RiskHistoryRow[] }>({
    updates: [],
    history: [],
  });
  const editingId = editing?.id ?? null;
  const pendingOpenId = useRef(openRiskId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await listRisks(board.id);
      if (!cancelled) {
        setRisks(rows);
        setLoading(false);
        const target = pendingOpenId.current ? rows.find((r) => r.id === pendingOpenId.current) : undefined;
        pendingOpenId.current = null;
        if (target) {
          setTab("content");
          setDetail({ updates: [], history: [] });
          setEditing({ id: target.id, input: target });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [board.id]);

  // 打開既有的一筆時,讀它的進度更新與紀錄。
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    (async () => {
      const d = await getRiskDetail(editingId);
      if (!cancelled && !d.error) setDetail({ updates: d.updates, history: d.history });
    })();
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  async function reload() {
    setRisks(await listRisks(board.id));
  }

  function openEditor(next: { id: string | null; input: RiskInput }) {
    setTab("content");
    setDetail({ updates: [], history: [] });
    setEditing(next);
  }

  /** 申請結案、審核、進度更新之後:列表、這一筆的更新與紀錄一起重讀,表單上的狀態也跟著現況走。 */
  async function refreshAfterAction() {
    const rows = await listRisks(board.id);
    setRisks(rows);
    if (editingId) {
      const d = await getRiskDetail(editingId);
      if (!d.error) setDetail({ updates: d.updates, history: d.history });
      const fresh = rows.find((r) => r.id === editingId);
      if (fresh) {
        setEditing((prev) => (prev && prev.id === editingId ? { ...prev, input: { ...prev.input, status: fresh.status } } : prev));
      }
    }
  }

  async function handleSave() {
    if (!editing) return;
    setBusy(true);
    try {
      const result = editing.id
        ? await updateRisk(editing.id, editing.input)
        : await createRisk(board.id, editing.input);
      if (result.error) {
        await notify(result.error, { title: "無法儲存" });
        return;
      }
      setEditing(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(risk: RiskRow, status: RiskStatus) {
    setBusy(true);
    try {
      const result = await setRiskStatus(risk.id, status);
      if (result.error) await notify(result.error, { title: "無法變更狀態" });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(risk: RiskRow) {
    const ok = await confirm(`刪除「${risk.title}」?`, { title: "刪除紀錄", confirmLabel: "刪除", danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await deleteRisk(risk.id);
      if (result.error) await notify(result.error, { title: "無法刪除" });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const hasMantis = risks.some((r) => r.mantis);
  const sorted = sortRisks(risks)
    .filter((r) => showClosed || r.status !== "CLOSED")
    .filter((r) => source === "all" || (source === "mantis" ? !!r.mantis : !r.mantis));
  const openCount = risks.filter((r) => r.status !== "CLOSED").length;
  const highCount = risks.filter(
    (r) => r.status !== "CLOSED" && riskBand(riskScore(r.probability, r.impact)).key === "critical"
  ).length;

  const emv = summarizeEmv(risks);

  // WBS 只在自己的分組樹裡唯一,所以一個分組算一次。
  const wbsByItemId = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of board.groups) {
      const groupItems = board.items.filter((i) => i.groupId === group.id);
      for (const [id, code] of computeWbsCodes(groupItems)) map.set(id, code);
    }
    return map;
  }, [board]);

  const liveRow = editing?.id ? (risks.find((r) => r.id === editing.id) ?? null) : null;

  // 選了相關工作項:列出它的起訖,並跟對策到期日比,讓人一眼看出設的期限有沒有落在那個工作項的時間內。
  const linkedItem = editing?.input.itemId ? board.items.find((i) => i.id === editing.input.itemId) : undefined;
  const linkedItemWindow = (() => {
    if (!linkedItem) return null;
    const read = (columnId: string | null) => {
      const value = columnId ? linkedItem.cellValues.find((cv) => cv.columnId === columnId)?.value : null;
      return typeof value === "string" ? value : null;
    };
    const start = read(board.ganttStartColumnId);
    const end = read(board.ganttEndColumnId);
    return { start, end, note: describeDueAgainstItem(editing?.input.dueDate ?? null, start, end) };
  })();
  // 新增時自己就是建立者;既有的看 server 算出來的權限。
  const canEditContent = !editing?.id || !!liveRow?.permissions.canEditContent;
  // Mantis 同步來的列:這一類欄位有沒有開寫回(沒開的唯讀,要到 Mantis 改);一般的風險 / 議題每個欄位都可以改。
  const mantisRow = liveRow?.mantis ?? null;
  const fieldOpen = (group: WriteField) => !mantisRow || mantisRow.writable.includes(group);

  const fieldClass =
    "w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => openEditor({ id: null, input: { ...EMPTY, ownerId: currentUserId } })}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={14} /> 新增風險 / 議題
        </button>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          未結案 {openCount} 筆{highCount > 0 && `,其中 ${highCount} 筆極高`}
        </span>
        {hasMantis && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            來源
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as "all" | "manual" | "mantis")}
              className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="all">全部</option>
              <option value="manual">手動建立</option>
              <option value="mantis">Mantis 同步</option>
            </select>
          </label>
        )}
        <label
          className={"flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400" + (hasMantis ? "" : " ml-auto")}
        >
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          顯示已結案
        </label>
      </div>

      {(emv.priced > 0 || emv.unpriced > 0) && (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="font-medium text-neutral-800 dark:text-neutral-100">
              風險金額合計(EMV) {formatMoney(emv.total)} 元
            </span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              全部發生的話 {formatMoney(emv.worstCase)} 元
            </span>
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              已估金額 {emv.priced} 項
              {emv.unpriced > 0 && `,還有 ${emv.unpriced} 項沒估`}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            EMV = 機率 × 發生時的金額,只算未結案的。這就是
            <b>應變準備金</b>該覆蓋的範圍——在預算頁的「準備金」分頁編列。
            {emv.unpriced > 0 && (
              <>
                {" "}
                <b>還有 {emv.unpriced} 項沒有填金額,沒有算進上面的數字</b>,
                所以這個合計是低估的。
              </>
            )}
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : sorted.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
          還沒有紀錄。NUDD 會議上談到的風險與議題,記在這裡才追得下去。
        </p>
      ) : (
<HScrollPane className="rounded-md border border-neutral-200 dark:border-neutral-700">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">類型</th>
                <th className="px-3 py-2 text-left font-medium">標題</th>
                <th className="px-2 py-2 text-center font-medium">機率</th>
                <th className="px-2 py-2 text-center font-medium">衝擊</th>
                <th className="px-2 py-2 text-center font-medium">分數</th>
                <th className="px-2 py-2 text-right font-medium">金額</th>
                <th className="px-2 py-2 text-right font-medium">EMV</th>
                <th className="px-3 py-2 text-left font-medium">對策與驗收標準</th>
                <th className="px-3 py-2 text-left font-medium">負責人</th>
                <th className="px-3 py-2 text-left font-medium">到期日</th>
                <th className="px-3 py-2 text-left font-medium">狀態</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {sorted.map((risk) => {
                const score = riskScore(risk.probability, risk.impact);
                const band = riskBand(score);
                return (
                  <tr
                    key={risk.id}
                    // 點到這一列任何地方就打開(能改的人直接編輯,不能改的檢視);列裡面的連結、狀態選單、按鈕各做各的事,不連帶打開。
                    onClick={() => openEditor({ id: risk.id, input: risk })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) {
                        // 不擋的話,焦點移進視窗後這個 Enter 的 keypress 會按下視窗的第一顆按鈕(關閉),視窗一開就關。
                        e.preventDefault();
                        openEditor({ id: risk.id, input: risk });
                      }
                    }}
                    tabIndex={0}
                    data-risk-row={risk.id}
                    className={`${risk.status === "CLOSED" ? "opacity-50" : ""} cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800`}
                  >
                    <td className="px-3 py-2 text-neutral-500 dark:text-neutral-400">
                      {riskKindLabel({ kind: risk.kind, mantisId: risk.mantis?.id ?? null })}
                    </td>
                    <td className="max-w-[280px] px-3 py-2">
                      <p className="flex items-center gap-1.5 text-neutral-800 dark:text-neutral-100">
                        {risk.mantis && (
                          <a
                            href={risk.mantis.url ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300"
                            title={"在 Mantis 開啟 #" + risk.mantis.id + (risk.mantis.status ? "(Mantis 狀態:" + risk.mantis.status + ")" : "")}
                          >
                            Mantis #{risk.mantis.id} <ExternalLink size={10} />
                          </a>
                        )}
                        <span className="truncate">{risk.title}</span>
                      </p>
                      {(risk.description || risk.itemName) && (
                        <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                          {risk.itemName ? `↳ ${risk.itemName}・` : ""}
                          {risk.description}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center text-neutral-600 dark:text-neutral-300">{risk.probability}</td>
                    <td className="px-2 py-2 text-center text-neutral-600 dark:text-neutral-300">{risk.impact}</td>
                    <td className="px-2 py-2 text-center">
                      <span
                        className="inline-block min-w-[2.5rem] rounded px-1.5 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: band.color }}
                        title={`${band.label}(${score})`}
                      >
                        {score}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                      {risk.costImpact === null ? "—" : formatMoney(risk.costImpact)}
                    </td>
                    <td
                      className="px-2 py-2 text-right tabular-nums font-medium text-neutral-800 dark:text-neutral-100"
                      title={
                        risk.costImpact === null
                          ? "沒有金額就算不出 EMV"
                          : `${Math.round(resolveProbability(risk) * 100)}% × ${formatMoney(risk.costImpact)}`
                      }
                    >
                      {riskEmv(risk) === null ? "—" : formatMoney(riskEmv(risk)!)}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-neutral-600 dark:text-neutral-300">
                      {risk.mitigation || <span className="text-neutral-300 dark:text-neutral-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{risk.ownerName ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-600 dark:text-neutral-300">{risk.dueDate ? withWeekday(risk.dueDate) : "—"}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {risk.permissions.canSetWorkingStatus ? (
                        <select
                          value={risk.status}
                          disabled={busy}
                          onChange={(e) => handleStatus(risk, e.target.value as RiskStatus)}
                          className="rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                        >
                          {WORKING_STATUSES.map((key) => (
                            <option key={key} value={key}>
                              {RISK_STATUS_LABELS[key]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CHIP_CLASS[risk.status]}`}>
                            {RISK_STATUS_LABELS[risk.status]}
                            {risk.status === "PENDING_REVIEW" &&
                              ` ${risk.reviewers.filter((r) => r.approvedAt).length}/${risk.reviewers.length}`}
                          </span>
                          {risk.permissions.canReview && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-200">
                              等你審核
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openEditor({ id: risk.id, input: risk })}
                        className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-blue-600"
                        aria-label={risk.permissions.canEditContent ? "編輯" : "檢視"}
                        title={risk.permissions.canEditContent ? "編輯" : "檢視、寫進度更新"}
                      >
                        <Pencil size={13} />
                      </button>
                      {risk.permissions.canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(risk)}
                          className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600"
                          aria-label="刪除"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </HScrollPane>
      )}

      <Modal
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? "編輯風險 / 議題" : "新增風險 / 議題"}
        size="lg"
      >
        {editing && (
          <div className="space-y-3">
            {liveRow && (
              <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-700 text-sm">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`-mb-px border-b-2 px-3 py-1.5 ${
                      tab === t.key
                        ? "border-blue-600 font-medium text-blue-700 dark:text-blue-300"
                        : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
                    }`}
                  >
                    {t.label}
                    {t.key === "updates" && detail.updates.length > 0 && `(${detail.updates.length})`}
                  </button>
                ))}
                <div className="ml-auto self-center pb-1">
                  <DiscussInChatButton boardId={board.id} kind={riskKindOf({ kind: liveRow.kind, mantisId: liveRow.mantis?.id ?? null })} id={liveRow.id} />
                </div>
              </div>
            )}

            {liveRow && tab === "updates" && (
              <UpdatesPanel
                riskId={liveRow.id}
                canPost={liveRow.permissions.canPostUpdate}
                updates={detail.updates}
                onChanged={refreshAfterAction}
              />
            )}
            {liveRow && tab === "todos" && <RiskTodosPanel riskId={liveRow.id} />}
            {liveRow && tab === "history" && <HistoryPanel history={detail.history} />}

            {(!liveRow || tab === "content") && (
            <>
            {liveRow?.mantis && (
              <div className="rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100">
                <p className="mb-0.5 font-medium">
                  從 Mantis 同步:
                  <a
                    href={liveRow.mantis.url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 inline-flex items-center gap-0.5 underline"
                  >
                    #{liveRow.mantis.id} <ExternalLink size={10} />
                  </a>
                </p>
                <p>
                  Mantis 狀態 {liveRow.mantis.status ?? "—"}・處理人 {liveRow.mantis.handler ?? "—"}
                  {liveRow.mantis.updatedAt ? "・更新於 " + new Date(liveRow.mantis.updatedAt).toLocaleString("zh-TW") : ""}
                </p>
                <p className="mt-0.5 text-indigo-700 dark:text-indigo-300">
                  {liveRow.mantis.writable.length > 0
                    ? `這個連線已開啟寫回 Mantis(${liveRow.mantis.writable.map((f) => WRITE_FIELD_LABELS[f]).join("、")}):在這裡修改、按儲存會馬上寫進 Mantis,Mantis 拒絕就整筆不存;沒開放的欄位請到 Mantis 修改。進度更新可以在這裡寫。`
                    : "內容與狀態以 Mantis 為準,這裡唯讀(下一次同步會蓋回來),要修改請到 Mantis。進度更新可以在這裡寫。"}
                </p>
              </div>
            )}
            {liveRow && <ClosureBar risk={liveRow} onChanged={refreshAfterAction} />}
            <fieldset disabled={!canEditContent} className="m-0 min-w-0 space-y-3 border-0 p-0">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">類型</span>
                <select
                  value={editing.input.kind}
                  disabled={!!mantisRow}
                  onChange={(e) =>
                    setEditing({ ...editing, input: { ...editing.input, kind: e.target.value as RiskKind } })
                  }
                  className={fieldClass}
                >
                  {(Object.keys(RISK_KIND_LABELS) as RiskKind[]).map((key) => (
                    <option key={key} value={key}>
                      {RISK_KIND_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">狀態</span>
                <select
                  value={editing.input.status}
                  disabled={editing.input.status === "PENDING_REVIEW" || !fieldOpen("status")}
                  onChange={(e) =>
                    setEditing({ ...editing, input: { ...editing.input, status: e.target.value as RiskStatus } })
                  }
                  className={fieldClass}
                  title="結案要由負責人申請、審核人全部同意"
                >
                  {!WORKING_STATUSES.includes(editing.input.status) && (
                    <option value={editing.input.status}>{RISK_STATUS_LABELS[editing.input.status]}</option>
                  )}
                  {WORKING_STATUSES.map((key) => (
                    <option key={key} value={key}>
                      {RISK_STATUS_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">標題</span>
              <input
                value={editing.input.title}
                disabled={!fieldOpen("content")}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, title: e.target.value } })}
                placeholder="例如:主控板 MCU 交期可能延到 12 週"
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">說明</span>
              <textarea
                value={editing.input.description}
                disabled={!fieldOpen("content") || !!mantisRow?.descriptionTruncated}
                title={mantisRow?.descriptionTruncated ? "說明很長,本系統只存了前面一段,請到 Mantis 修改" : undefined}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, description: e.target.value } })}
                rows={2}
                className={fieldClass}
              />
              {mantisRow?.notes && (
                <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-neutral-50 px-2 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  {mantisRow.notes}
                </pre>
              )}
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">機率(1-5)</span>
                <select
                  value={editing.input.probability}
                  disabled={!!mantisRow}
                  title={mantisRow ? "Mantis 的問題是已經發生的事,機率固定最高" : undefined}
                  onChange={(e) =>
                    setEditing({ ...editing, input: { ...editing.input, probability: Number(e.target.value) } })
                  }
                  className={fieldClass}
                >
                  {LEVELS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">衝擊(1-5)</span>
                <select
                  value={editing.input.impact}
                  disabled={!fieldOpen("severity")}
                  title={mantisRow ? "對應 Mantis 的嚴重度(對應表在系統設定的 Mantis 卡片)" : undefined}
                  onChange={(e) =>
                    setEditing({ ...editing, input: { ...editing.input, impact: Number(e.target.value) } })
                  }
                  className={fieldClass}
                >
                  {LEVELS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                  發生的話要多少錢(元)
                </span>
                <input
                  type="number"
                  min={0}
                  value={editing.input.costImpact ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      input: {
                        ...editing.input,
                        costImpact: e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                  placeholder="留空表示還沒估"
                  className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                  機率 %(選填)
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={editing.input.probabilityPct ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      input: {
                        ...editing.input,
                        probabilityPct: e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                  placeholder={`留空則用「${editing.input.probability}」= ${PROBABILITY_BY_LEVEL[editing.input.probability] ?? 50}%`}
                  className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
                />
              </label>
              {mantisRow && (
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">Mantis 優先權</span>
                  <select
                    value={editing.input.mantisPriorityId ?? ""}
                    disabled={!fieldOpen("severity") || mantisRow.priorityOptions.length === 0}
                    onChange={(e) =>
                      setEditing({ ...editing, input: { ...editing.input, mantisPriorityId: e.target.value ? Number(e.target.value) : null } })
                    }
                    className={fieldClass}
                  >
                    {editing.input.mantisPriorityId == null && <option value="">—</option>}
                    {mantisRow.priorityOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.text}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div>
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">分數</span>
                <div
                  className="rounded-md px-2 py-1 text-center text-sm font-medium text-white"
                  style={{
                    backgroundColor: riskBand(riskScore(editing.input.probability, editing.input.impact)).color,
                  }}
                >
                  {riskScore(editing.input.probability, editing.input.impact)}
                  {" "}
                  {riskBand(riskScore(editing.input.probability, editing.input.impact)).label}
                </div>
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                對策與驗收標準(由指派的人寫給負責人)
              </span>
              <textarea
                value={editing.input.mitigation}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, mitigation: e.target.value } })}
                rows={3}
                placeholder="要做什麼、測試標準與需求、做到什麼程度才算解除"
                className={fieldClass}
              />
            </label>

            <div className="grid grid-cols-3 gap-3">
              <div className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">負責人</span>
                <div
                  className={`rounded-md border border-neutral-300 dark:border-neutral-600 ${fieldOpen("handler") ? "" : "pointer-events-none opacity-50"}`}
                  aria-disabled={!fieldOpen("handler")}
                >
                  <PersonPicker
                    users={users.filter((u) => !u.isResource)}
                    selectedId={editing.input.ownerId ?? null}
                    placeholder="未指定"
                    unassignedLabel="未指定"
                    onSelect={(ownerId) => setEditing({ ...editing, input: { ...editing.input, ownerId } })}
                  />
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">對策到期日</span>
                <input
                  type="date"
                  value={editing.input.dueDate ?? ""}
                  disabled={!fieldOpen("content")}
                  onChange={(e) =>
                    setEditing({ ...editing, input: { ...editing.input, dueDate: e.target.value || null } })
                  }
                  className={fieldClass}
                />
                <DateWeekdayHint value={editing.input.dueDate} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">相關工作項</span>
                <div className={mantisRow ? "pointer-events-none opacity-50" : ""} aria-disabled={!!mantisRow} title={mantisRow ? "Mantis 同步來的問題固定掛在 ISSUE 工作項底下" : undefined}>
                <ItemTreePicker
                  items={board.items}
                  wbsByItemId={wbsByItemId}
                  value={editing.input.itemId ?? ""}
                  onChange={(id) =>
                    setEditing({ ...editing, input: { ...editing.input, itemId: id || null } })
                  }
                  className={`${fieldClass} flex items-center justify-between gap-1`}
                />
                </div>
              </label>
            </div>

            {linkedItemWindow && (
              <div
                data-risk-item-window
                className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-800"
              >
                <p className="text-neutral-600 dark:text-neutral-300">
                  工作項的時間:
                  <span className="tabular-nums">
                    {linkedItemWindow.start ? withWeekday(linkedItemWindow.start) : "未設定"} ~{" "}
                    {linkedItemWindow.end ? withWeekday(linkedItemWindow.end) : "未設定"}
                  </span>
                </p>
                <p
                  className={
                    linkedItemWindow.note.tone === "warn"
                      ? "mt-0.5 text-amber-700 dark:text-amber-300"
                      : linkedItemWindow.note.tone === "ok"
                        ? "mt-0.5 text-green-700 dark:text-green-400"
                        : "mt-0.5 text-neutral-500 dark:text-neutral-400"
                  }
                >
                  {linkedItemWindow.note.tone === "warn" ? "⚠ " : linkedItemWindow.note.tone === "ok" ? "✓ " : ""}
                  {linkedItemWindow.note.text}
                </p>
              </div>
            )}

            <div>
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                審核人(申請結案後,每一位都同意才算解除)
              </span>
              <ReviewerEditor
                users={users}
                value={editing.input.reviewerIds}
                onChange={(reviewerIds) => setEditing({ ...editing, input: { ...editing.input, reviewerIds } })}
              />
              {editing.input.status === "PENDING_REVIEW" && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  待審核中不能更換審核人,要換請先撤回申請結案。
                </p>
              )}
            </div>
            </fieldset>

            {liveRow?.createdByName && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                建立者:{liveRow.createdByName}・{new Date(liveRow.createdAt).toLocaleString("zh-TW")}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                {canEditContent ? "取消" : "關閉"}
              </button>
              {canEditContent && (
                <button
                  type="button"
                  disabled={busy || !editing.input.title.trim()}
                  onClick={handleSave}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  儲存
                </button>
              )}
            </div>
            </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
