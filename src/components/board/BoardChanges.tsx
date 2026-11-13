"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChangeStatus, UserRole } from "@prisma/client";
import { Plus, Trash2, Pencil, Link2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { BoardWithData } from "@/types/board";
import { canManageStructure } from "@/lib/permissions";
import { computeWbsCodes } from "@/lib/wbs";
import { ItemTreePicker } from "./ItemTreePicker";
import { listBaselines, type BaselineVersion } from "@/lib/actions/baseline";
import {
  listChangeRequests,
  createChangeRequest,
  updateChangeRequest,
  submitChangeRequest,
  withdrawChangeRequest,
  decideChangeRequest,
  implementChangeRequest,
  deleteChangeRequest,
  type ChangeRequestRow,
  type ChangeRequestInput,
} from "@/lib/actions/changeRequest";
import { withWeekday } from "@/lib/weekdayLabel";

const STATUS_LABELS: Record<ChangeStatus, string> = {
  DRAFT: "草稿",
  SUBMITTED: "待審",
  APPROVED: "已核准",
  REJECTED: "駁回",
  IMPLEMENTED: "已執行",
  WITHDRAWN: "已撤回",
};

const STATUS_CLASS: Record<ChangeStatus, string> = {
  DRAFT: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  SUBMITTED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  APPROVED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  IMPLEMENTED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  WITHDRAWN: "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500",
};

const EMPTY: ChangeRequestInput = {
  title: "",
  description: "",
  reason: "",
  scheduleImpactDays: null,
  costImpact: null,
  impactNote: "",
  itemIds: [],
};

/**
 * 變更管理 — why the plan changed, who said yes, and what it was expected to
 * cost.
 *
 * The baseline already keeps what the dates became. What nobody could
 * reconstruct afterwards was the reason, the approval and the estimate made at
 * the time — which is what every argument three months later is actually
 * about. Marking a change 已執行 ties it to the baseline version that carried
 * it, so the two halves meet.
 */
export function BoardChanges({
  board,
  userRole,
}: {
  board: BoardWithData;
  userRole: UserRole;
}) {
  const { notify, confirm, prompt } = useDialogs();
  const [rows, setRows] = useState<ChangeRequestRow[]>([]);
  const [baselines, setBaselines] = useState<BaselineVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; input: ChangeRequestInput } | null>(null);

  const canDecide = canManageStructure(userRole);

  const reload = useCallback(async () => {
    const [requests, versions] = await Promise.all([
      listChangeRequests(board.id),
      listBaselines(board.id),
    ]);
    setRows(requests);
    setBaselines(versions);
  }, [board.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [requests, versions] = await Promise.all([
        listChangeRequests(board.id),
        listBaselines(board.id),
      ]);
      if (!cancelled) {
        setRows(requests);
        setBaselines(versions);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [board.id]);

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
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!editing) return;
    const ok = await run(
      () =>
        editing.id
          ? updateChangeRequest(editing.id, editing.input)
          : createChangeRequest(board.id, editing.input),
      "無法儲存變更單"
    );
    if (ok) setEditing(null);
  }

  async function handleDecide(row: ChangeRequestRow, status: "APPROVED" | "REJECTED") {
    const note = await prompt(
      status === "APPROVED" ? "核准說明(選填)" : "駁回的原因是什麼?",
      {
        title: status === "APPROVED" ? "核准變更" : "駁回變更",
        required: status === "REJECTED",
        confirmLabel: status === "APPROVED" ? "核准" : "駁回",
      }
    );
    if (note === null) return;
    await run(() => decideChangeRequest(row.id, status, note), "無法送出決定");
  }

  async function handleImplement(row: ChangeRequestRow) {
    // The baseline captured for this change is what turns "approved" into
    // "here is what it did to the plan".
    const options = baselines.map((b, i) => `${i + 1}. ${b.name}`).join("\n");
    const answer = await prompt(
      `要連到哪一版基準線?輸入編號,留空表示不連。

${options || "(這個看板還沒有基準線)"}`,
      { title: "標記為已執行", placeholder: "基準線編號", numeric: true }
    );
    if (answer === null) return;
    const index = Number(answer.trim());
    const baselineId =
      answer.trim() && Number.isInteger(index) && index >= 1 && index <= baselines.length
        ? baselines[index - 1].id
        : null;
    await run(() => implementChangeRequest(row.id, baselineId), "無法標記為已執行");
  }

  const fieldClass =
    "w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500";
  const smallButton =
    "rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40";

  // WBS 只在自己的分組樹裡唯一,所以一個分組算一次。
  const wbsByItemId = new Map<string, string>();
  for (const group of board.groups) {
    const groupItems = board.items.filter((i) => i.groupId === group.id);
    for (const [id, code] of computeWbsCodes(groupItems)) wbsByItemId.set(id, code);
  }

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">變更管理</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          規格或時程要改,先開一張單:為什麼改、影響多少、誰批准。
        </p>
        <button
          type="button"
          onClick={() => setEditing({ id: null, input: { ...EMPTY } })}
          className="ml-auto flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={14} /> 開變更單
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
          還沒有變更單。下次因為規格改動而要重設基準線時,先開一張——
          之後才查得到日期為什麼變。
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-400 dark:text-neutral-500">
                  CR-{String(row.number).padStart(3, "0")}
                </span>
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {row.title}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[row.status]}`}>
                  {STATUS_LABELS[row.status]}
                </span>
                {row.scheduleImpactDays !== null && (
                  <span
                    className={`text-xs tabular-nums ${
                      row.scheduleImpactDays > 0 ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    時程 {row.scheduleImpactDays > 0 ? "+" : ""}
                    {row.scheduleImpactDays} 天
                  </span>
                )}
                {row.costImpact !== null && (
                  <span
                    className={`text-xs tabular-nums ${
                      row.costImpact > 0 ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    成本 {row.costImpact > 0 ? "+" : ""}
                    {row.costImpact.toLocaleString()} 元
                  </span>
                )}

                <div className="ml-auto flex items-center gap-1">
                  {row.status === "DRAFT" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => submitChangeRequest(row.id), "無法送審")}
                      className={smallButton}
                    >
                      送審
                    </button>
                  )}
                  {row.status === "SUBMITTED" && canDecide && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDecide(row, "APPROVED")}
                        className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
                      >
                        核准
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDecide(row, "REJECTED")}
                        className={smallButton}
                      >
                        駁回
                      </button>
                    </>
                  )}
                  {row.status === "APPROVED" && canDecide && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleImplement(row)}
                      className={smallButton}
                    >
                      標記已執行
                    </button>
                  )}
                  {(row.status === "DRAFT" || row.status === "SUBMITTED") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setEditing({
                          id: row.id,
                          input: {
                            title: row.title,
                            description: row.description,
                            reason: row.reason,
                            scheduleImpactDays: row.scheduleImpactDays,
                            costImpact: row.costImpact,
                            impactNote: row.impactNote,
                            itemIds: row.itemIds,
                          },
                        })
                      }
                      className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-blue-600 disabled:opacity-40"
                      aria-label="編輯"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {row.isMine && row.status !== "IMPLEMENTED" && row.status !== "WITHDRAWN" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await confirm(`撤回 CR-${row.number}?`, {
                          title: "撤回變更單",
                          confirmLabel: "撤回",
                        });
                        if (ok) await run(() => withdrawChangeRequest(row.id), "無法撤回");
                      }}
                      className={smallButton}
                    >
                      撤回
                    </button>
                  )}
                  {(row.status === "DRAFT" || row.status === "WITHDRAWN") && canDecide && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await confirm(`刪除 CR-${row.number}?`, {
                          title: "刪除變更單",
                          confirmLabel: "刪除",
                          danger: true,
                        });
                        if (ok) await run(() => deleteChangeRequest(row.id), "無法刪除");
                      }}
                      className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-40"
                      aria-label="刪除"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {row.reason && (
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  <span className="text-neutral-400 dark:text-neutral-500">原因:</span> {row.reason}
                </p>
              )}
              {row.itemNames.length > 0 && (
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  影響 {row.itemIds.length} 項:{row.itemNames.slice(0, 4).join("、")}
                  {row.itemNames.length > 4 && " 等"}
                </p>
              )}
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400 dark:text-neutral-500">
                <span>{row.requestedByName} 提出 · {withWeekday(row.createdAt.slice(0, 10))}</span>
                {row.decidedByName && (
                  <span>
                    {STATUS_LABELS[row.status]}:{row.decidedByName} · {row.decidedAt && withWeekday(row.decidedAt.slice(0, 10))}
                    {row.decisionNote && `（${row.decisionNote}）`}
                  </span>
                )}
                {row.baselineName && (
                  <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
                    <Link2 size={11} /> 基準線「{row.baselineName}」
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? "編輯變更單" : "開立變更單"}
      >
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">標題</label>
              <input
                autoFocus
                value={editing.input.title}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, title: e.target.value } })}
                placeholder="例如 電池模組改用 B 供應商"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                變更原因(必填)
              </label>
              <textarea
                rows={2}
                value={editing.input.reason}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, reason: e.target.value } })}
                placeholder="為什麼非改不可"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">變更內容</label>
              <textarea
                rows={2}
                value={editing.input.description}
                onChange={(e) =>
                  setEditing({ ...editing, input: { ...editing.input, description: e.target.value } })
                }
                placeholder="要改什麼"
                className={fieldClass}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                  時程影響(天,可負)
                </label>
                <input
                  type="number"
                  value={editing.input.scheduleImpactDays ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      input: {
                        ...editing.input,
                        scheduleImpactDays: e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                  className={fieldClass}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                  成本影響(元,可負)
                </label>
                <input
                  type="number"
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
                  className={fieldClass}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
                受影響的工作項
              </label>
              <ItemTreePicker
                items={board.items}
                wbsByItemId={wbsByItemId}
                value=""
                onChange={(id) => {
                  if (!id || editing.input.itemIds.includes(id)) return;
                  setEditing({
                    ...editing,
                    input: { ...editing.input, itemIds: [...editing.input.itemIds, id] },
                  });
                }}
                placeholder="加入工作項…"
                className={`${fieldClass} flex items-center justify-between gap-1`}
              />
              {editing.input.itemIds.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {editing.input.itemIds.map((id) => {
                    const item = board.items.find((i) => i.id === id);
                    return (
                      <li
                        key={id}
                        className="flex items-center gap-1 rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-700 dark:text-neutral-200"
                      >
                        {item ? `${wbsByItemId.get(item.id) ?? ""} ${item.name}` : id}
                        <button
                          type="button"
                          onClick={() =>
                            setEditing({
                              ...editing,
                              input: {
                                ...editing.input,
                                itemIds: editing.input.itemIds.filter((x) => x !== id),
                              },
                            })
                          }
                          className="text-neutral-400 hover:text-red-600"
                          aria-label="移除"
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-300"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy || !editing.input.title.trim() || !editing.input.reason.trim()}
                onClick={handleSave}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                儲存
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
