"use client";

import { useEffect, useState } from "react";
import type { RiskKind, RiskStatus } from "@prisma/client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { BoardWithData, UserOption } from "@/types/board";
import {
  riskScore,
  riskBand,
  sortRisks,
  RISK_KIND_LABELS,
  RISK_STATUS_LABELS,
} from "@/lib/riskRegister";
import {
  listRisks,
  createRisk,
  updateRisk,
  setRiskStatus,
  deleteRisk,
  type RiskRow,
  type RiskInput,
} from "@/lib/actions/risk";

const EMPTY: RiskInput = {
  kind: "RISK",
  status: "OPEN",
  title: "",
  description: "",
  probability: 3,
  impact: 3,
  mitigation: "",
  ownerId: null,
  dueDate: null,
  itemId: null,
};

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
}: {
  board: BoardWithData;
  users: UserOption[];
  currentUserId: string;
}) {
  const { notify, confirm } = useDialogs();
  const [risks, setRisks] = useState<RiskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; input: RiskInput } | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await listRisks(board.id);
      if (!cancelled) {
        setRisks(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [board.id]);

  async function reload() {
    setRisks(await listRisks(board.id));
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
      await setRiskStatus(risk.id, status);
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
      await deleteRisk(risk.id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const sorted = sortRisks(risks).filter((r) => showClosed || r.status !== "CLOSED");
  const openCount = risks.filter((r) => r.status !== "CLOSED").length;
  const highCount = risks.filter(
    (r) => r.status !== "CLOSED" && riskBand(riskScore(r.probability, r.impact)).key === "critical"
  ).length;

  const fieldClass =
    "w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing({ id: null, input: { ...EMPTY, ownerId: currentUserId } })}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={14} /> 新增風險 / 議題
        </button>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          未結案 {openCount} 筆{highCount > 0 && `,其中 ${highCount} 筆極高`}
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          顯示已結案
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : sorted.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
          還沒有紀錄。NUDD 會議上談到的風險與議題,記在這裡才追得下去。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-700">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">類型</th>
                <th className="px-3 py-2 text-left font-medium">標題</th>
                <th className="px-2 py-2 text-center font-medium">機率</th>
                <th className="px-2 py-2 text-center font-medium">衝擊</th>
                <th className="px-2 py-2 text-center font-medium">分數</th>
                <th className="px-3 py-2 text-left font-medium">對策</th>
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
                    className={`${risk.status === "CLOSED" ? "opacity-50" : ""} hover:bg-neutral-50 dark:hover:bg-neutral-800`}
                  >
                    <td className="px-3 py-2 text-neutral-500 dark:text-neutral-400">
                      {RISK_KIND_LABELS[risk.kind]}
                    </td>
                    <td className="max-w-[280px] px-3 py-2">
                      <p className="truncate text-neutral-800 dark:text-neutral-100">{risk.title}</p>
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
                    <td className="max-w-[220px] truncate px-3 py-2 text-neutral-600 dark:text-neutral-300">
                      {risk.mitigation || <span className="text-neutral-300 dark:text-neutral-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{risk.ownerName ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{risk.dueDate ?? "—"}</td>
                    <td className="px-3 py-2">
                      <select
                        value={risk.status}
                        disabled={busy}
                        onChange={(e) => handleStatus(risk, e.target.value as RiskStatus)}
                        className="rounded border border-neutral-200 dark:border-neutral-700 bg-transparent px-1 py-0.5 text-xs outline-none focus:border-blue-500"
                      >
                        {(Object.keys(RISK_STATUS_LABELS) as RiskStatus[]).map((key) => (
                          <option key={key} value={key}>
                            {RISK_STATUS_LABELS[key]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: risk.id, input: risk })}
                        className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-blue-600"
                        aria-label="編輯"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(risk)}
                        className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600"
                        aria-label="刪除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? "編輯風險 / 議題" : "新增風險 / 議題"}
        size="lg"
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">類型</span>
                <select
                  value={editing.input.kind}
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
                  onChange={(e) =>
                    setEditing({ ...editing, input: { ...editing.input, status: e.target.value as RiskStatus } })
                  }
                  className={fieldClass}
                >
                  {(Object.keys(RISK_STATUS_LABELS) as RiskStatus[]).map((key) => (
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
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, title: e.target.value } })}
                placeholder="例如:主控板 MCU 交期可能延到 12 週"
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">說明</span>
              <textarea
                value={editing.input.description}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, description: e.target.value } })}
                rows={2}
                className={fieldClass}
              />
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">機率(1-5)</span>
                <select
                  value={editing.input.probability}
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
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">對策</span>
              <textarea
                value={editing.input.mitigation}
                onChange={(e) => setEditing({ ...editing, input: { ...editing.input, mitigation: e.target.value } })}
                rows={2}
                placeholder="要做什麼、做到什麼程度才算解除"
                className={fieldClass}
              />
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">負責人</span>
                <select
                  value={editing.input.ownerId ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, input: { ...editing.input, ownerId: e.target.value || null } })
                  }
                  className={fieldClass}
                >
                  <option value="">未指定</option>
                  {users
                    .filter((u) => !u.isResource)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">對策到期日</span>
                <input
                  type="date"
                  value={editing.input.dueDate ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, input: { ...editing.input, dueDate: e.target.value || null } })
                  }
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">相關工作項</span>
                <select
                  value={editing.input.itemId ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, input: { ...editing.input, itemId: e.target.value || null } })
                  }
                  className={fieldClass}
                >
                  <option value="">未指定</option>
                  {board.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy || !editing.input.title.trim()}
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
