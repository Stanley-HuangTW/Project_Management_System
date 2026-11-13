"use client";

import { UserSelect } from "@/components/ui/UserSelect";
import { useCallback, useEffect, useState } from "react";
import type { GateStatus } from "@prisma/client";
import { AlertTriangle, Check, Plus, Trash2, X, ChevronRight, ChevronDown } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { BoardWithData, UserOption } from "@/types/board";
import { canManageStructure } from "@/lib/permissions";
import { computeWbsCodes } from "@/lib/wbs";
import { ItemTreePicker } from "./ItemTreePicker";
import type { UserRole } from "@prisma/client";
import {
  listGates,
  createGate,
  deleteGate,
  addCriterion,
  setCriterionMet,
  deleteCriterion,
  setCriterionApprovers,
  signCriterion,
  setApprovers,
  submitGate,
  reopenGate,
  signGate,
  decideGate,
  type GateBoardView,
  type GateRow,
  type GateCriterionRow,
} from "@/lib/actions/gate";
import { withWeekday } from "@/lib/weekdayLabel";
import { DateWeekdayHint } from "@/components/ui/DateWeekdayHint";

const STATUS_LABELS: Record<GateStatus, string> = {
  DRAFT: "準備中",
  PENDING: "待審",
  PASSED: "已放行",
  FAILED: "不通過",
  WAIVED: "有條件放行",
};

const STATUS_CLASS: Record<GateStatus, string> = {
  DRAFT: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  PASSED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  WAIVED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
};

/**
 * 階段閘門 — POC→EVT→PVT 的關卡,以及誰放行的紀錄。
 *
 * The system does not stop anybody starting the next phase early; blocking
 * edits in a tool people use all day only teaches them to delete the gate.
 * What it does is say plainly who has gone ahead — that is what the 闖關
 * banner at the top is — so the review has something concrete to be about.
 */
export function BoardGates({
  board,
  users,
  userRole,
  currentUserId,
}: {
  board: BoardWithData;
  users: UserOption[];
  userRole: UserRole;
  currentUserId: string;
}) {
  const { notify, confirm, prompt } = useDialogs();
  const [view, setView] = useState<GateBoardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newItemId, setNewItemId] = useState("");
  const [newDate, setNewDate] = useState("");

  const canManage = canManageStructure(userRole);
  // Only real people can sign — a Resource (tool, vendor) has no account.
  const staff = users.filter((u) => !u.isResource);

  const reload = useCallback(async () => {
    setView(await listGates(board.id));
  }, [board.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listGates(board.id);
      if (!cancelled) {
        setView(result);
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

  async function handleCreate() {
    const ok = await run(
      () => createGate(board.id, { name: newName, itemId: newItemId || null, plannedDate: newDate || null }),
      "無法建立閘門"
    );
    if (ok) {
      setNewName("");
      setNewItemId("");
      setNewDate("");
      setAdding(false);
    }
  }

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!view) return null;

  // Phase rows are the ones a gate closes: the summary items somebody has
  // hung a stage off. Everything else would make a gate about one task.
  const parentIds = new Set(board.items.map((i) => i.parentId).filter(Boolean));
  const phaseChoices = board.items.filter((i) => parentIds.has(i.id));

  // WBS 只在自己的分組樹裡唯一,所以一個分組算一次。
  const wbsByItemId = new Map<string, string>();
  for (const group of board.groups) {
    const groupItems = board.items.filter((i) => i.groupId === group.id);
    for (const [id, code] of computeWbsCodes(groupItems)) wbsByItemId.set(id, code);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">階段閘門</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          每個階段的出口審查:條件、簽核人,以及是誰放行的。
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="ml-auto flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus size={14} /> 新增閘門
          </button>
        )}
      </div>

      {view.breaches.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900 dark:text-amber-200">
            <AlertTriangle size={14} /> 有工作跑在閘門前面
          </p>
          <ul className="mt-2 space-y-1">
            {view.breaches.map((breach) => (
              <li key={breach.gateId} className="text-xs text-amber-900 dark:text-amber-200">
                「{breach.gateName}」還是{STATUS_LABELS[breach.gateStatus]},但下一階段「
                {breach.nextPhaseName}」已經有 {breach.startedCount} 項工作在進行(
                {breach.startedNames.join("、")}
                {breach.startedCount > breach.startedNames.length && " 等"})。
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="閘門名稱,例如 EVT 出口審查"
            className={`${fieldClass} min-w-0 flex-1`}
          />
          <ItemTreePicker
            items={phaseChoices}
            wbsByItemId={wbsByItemId}
            value={newItemId}
            onChange={setNewItemId}
            placeholder="(不綁階段)"
            className={`${fieldClass} flex items-center justify-between gap-1`}
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            title="預計審查日"
            className={fieldClass}
          />
          <DateWeekdayHint value={newDate} />
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={handleCreate}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            建立
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="rounded p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-100"
            aria-label="取消"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {view.gates.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
          還沒有閘門。把 POC / EVT / PVT 各建一個,填上出口條件和簽核人,
          之後就查得到每一關是誰放行的。
        </p>
      ) : (
        <ul className="space-y-3">
          {view.gates.map((gate) => (
            <GateCard
              key={gate.id}
              gate={gate}
              staff={staff}
              currentUserId={currentUserId}
              canManage={canManage}
              busy={busy}
              run={run}
              confirm={confirm}
              prompt={prompt}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 一條出口條件的確認人:列出每個人同意 / 不同意與備註;被指定的人(canSign)可以在這裡表態並寫備註;
 * 有設定權限的人可以加人、拿掉人。有確認人時,這一條「達成」由大家表態決定(全部同意才算)。
 */
function CriterionApprovers({
  criterion,
  staff,
  canManage,
  busy,
  run,
}: {
  criterion: GateCriterionRow;
  staff: UserOption[];
  canManage: boolean;
  busy: boolean;
  run: (work: () => Promise<{ error?: string }>, failTitle: string) => Promise<boolean>;
}) {
  const [comment, setComment] = useState("");
  const ids = criterion.approvers.map((a) => a.userId);
  if (criterion.approvers.length === 0 && !canManage) return null;

  return (
    <div className="ml-6 w-full space-y-1" data-criterion-approvers={criterion.id}>
      {criterion.approvers.map((a) => (
        <div key={a.userId} className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="w-24 shrink-0 truncate text-neutral-600 dark:text-neutral-300">{a.userName}</span>
          {a.decision === "APPROVED" ? (
            <span className="flex items-center gap-0.5 text-green-600">
              <Check size={11} /> 同意
            </span>
          ) : a.decision === "REJECTED" ? (
            <span className="flex items-center gap-0.5 text-red-600">
              <X size={11} /> 不同意
            </span>
          ) : (
            <span className="text-neutral-400 dark:text-neutral-500">未表態</span>
          )}
          {a.decidedAt && <span className="tabular-nums text-neutral-400 dark:text-neutral-500">{withWeekday(a.decidedAt.slice(0, 10))}</span>}
          {a.comment && <span className="min-w-0 flex-1 truncate text-neutral-500 dark:text-neutral-400">{a.comment}</span>}
          {canManage && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() => setCriterionApprovers(criterion.id, ids.filter((id) => id !== a.userId)), "無法移除確認人")
              }
              className="text-neutral-300 hover:text-red-600 dark:text-neutral-600"
              aria-label={`移除確認人 ${a.userName}`}
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}

      {criterion.canSign && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 p-1.5 dark:border-blue-900 dark:bg-blue-950/40">
          <span className="text-[11px] font-medium text-blue-900 dark:text-blue-200">你是這一條的確認人</span>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="備註(不同意要寫原因)"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
          />
          <button
            type="button"
            disabled={busy}
            data-criterion-approve
            onClick={async () => {
              if (await run(() => signCriterion(criterion.id, "APPROVED", comment), "無法表態")) setComment("");
            }}
            className="rounded bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-40"
          >
            同意
          </button>
          <button
            type="button"
            disabled={busy}
            data-criterion-reject
            onClick={async () => {
              if (await run(() => signCriterion(criterion.id, "REJECTED", comment), "無法表態")) setComment("");
            }}
            className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-40"
          >
            不同意
          </button>
        </div>
      )}

      {canManage && (
        <UserSelect
          users={staff.filter((u) => !ids.includes(u.id))}
          value=""
          disabled={busy}
          placeholder={criterion.approvers.length === 0 ? "指定確認人(可多位)…" : "再加一位確認人…"}
          onChange={(userId) => {
            if (!userId) return;
            run(() => setCriterionApprovers(criterion.id, [...ids, userId]), "無法指定確認人");
          }}
          className="w-56 rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
        />
      )}
    </div>
  );
}

function GateCard({
  gate,
  staff,
  currentUserId,
  canManage,
  busy,
  run,
  confirm,
  prompt,
}: {
  gate: GateRow;
  staff: UserOption[];
  currentUserId: string;
  canManage: boolean;
  busy: boolean;
  run: (work: () => Promise<{ error?: string }>, failTitle: string) => Promise<boolean>;
  confirm: (message: string, options?: Record<string, unknown>) => Promise<boolean>;
  /** Passed down rather than taken from a hook here: a bare `prompt` inside
   *  this component resolves to window.prompt, which the desktop app's
   *  embedded browser silently ignores. */
  prompt: ReturnType<typeof useDialogs>["prompt"];
}) {
  const [open, setOpen] = useState(gate.status === "PENDING");
  const [criterionText, setCriterionText] = useState("");
  const [criterionRequired, setCriterionRequired] = useState(true);
  const [signComment, setSignComment] = useState("");

  const mine = gate.approvers.find((a) => a.userId === currentUserId);
  const decided = gate.status === "PASSED" || gate.status === "WAIVED" || gate.status === "FAILED";
  const requiredTotal = gate.criteria.filter((c) => c.required).length;
  const requiredMet = gate.criteria.filter((c) => c.required && c.met).length;

  async function handleDecide(status: "PASSED" | "FAILED" | "WAIVED") {
    let note = "";
    if (status !== "PASSED") {
      const answer = await prompt(
        status === "WAIVED"
          ? "必要條件沒有全部達成,為什麼決定往下走?這是之後唯一查得到當初為什麼放行的紀錄。"
          : "不通過的原因是什麼?寫清楚要補什麼,否則沒有人知道下一步。",
        {
          title: status === "WAIVED" ? "有條件放行" : "不通過",
          required: true,
          confirmLabel: status === "WAIVED" ? "放行" : "不通過",
        }
      );
      if (answer === null) return;
      note = answer;
    }
    await run(() => decideGate(gate.id, status, note), "無法送出決定");
  }

  const smallButton =
    "rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40";

  return (
    <li className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-neutral-400 dark:text-neutral-500"
          aria-label={open ? "收合" : "展開"}
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{gate.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[gate.status]}`}>
          {STATUS_LABELS[gate.status]}
        </span>
        {gate.itemName && (
          <span className="text-xs text-neutral-400 dark:text-neutral-500">{gate.itemName}</span>
        )}
        {gate.plannedDate && (
          <span className="text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
            預計 {withWeekday(gate.plannedDate)}
          </span>
        )}
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          必要條件 {requiredMet}/{requiredTotal} · 簽核 {gate.approvers.filter((a) => a.decision === "APPROVED").length}/
          {gate.approvers.length}
        </span>

        {canManage && (
          <div className="ml-auto flex items-center gap-1">
            {(gate.status === "DRAFT" || gate.status === "FAILED") && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => submitGate(gate.id), "無法送審")}
                className={smallButton}
              >
                送審
              </button>
            )}
            {gate.status === "PENDING" && (
              <>
                <button
                  type="button"
                  disabled={busy || !gate.canPass}
                  title={gate.canPass ? undefined : gate.blockers.join("、")}
                  onClick={() => handleDecide("PASSED")}
                  className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
                >
                  放行
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDecide("WAIVED")}
                  className={smallButton}
                >
                  有條件放行
                </button>
                <button type="button" disabled={busy} onClick={() => handleDecide("FAILED")} className={smallButton}>
                  不通過
                </button>
              </>
            )}
            {decided && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm("退回待審?所有人的簽核會被清掉——他們簽的是當時的狀態。", {
                    title: "退回重審",
                    confirmLabel: "退回",
                  });
                  if (ok) await run(() => reopenGate(gate.id), "無法退回");
                }}
                className={smallButton}
              >
                退回重審
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await confirm(`刪除閘門「${gate.name}」?條件與簽核紀錄會一起消失。`, {
                  title: "刪除閘門",
                  confirmLabel: "刪除",
                  danger: true,
                });
                if (ok) await run(() => deleteGate(gate.id), "無法刪除");
              }}
              className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-40"
              aria-label="刪除閘門"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {gate.decisionNote && (
        <p className="border-t border-neutral-100 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300">
          <span className="font-medium">
            {gate.decidedByName} 於 {gate.decidedAt && withWeekday(gate.decidedAt.slice(0, 10))}：
          </span>{" "}
          {gate.decisionNote}
        </p>
      )}

      {open && (
        <div className="space-y-3 border-t border-neutral-100 dark:border-neutral-800 px-3 py-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">出口條件</p>
            {gate.criteria.length === 0 ? (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">還沒有條件。</p>
            ) : (
              <ul className="space-y-1">
                {gate.criteria.map((criterion) => (
                  <li key={criterion.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={criterion.met}
                      title={criterion.approvers.length > 0 ? "有指定確認人:是否達成由他們表態決定" : undefined}
                      disabled={busy || gate.status === "PASSED" || gate.status === "WAIVED" || criterion.approvers.length > 0}
                      onChange={(e) =>
                        run(() => setCriterionMet(criterion.id, e.target.checked), "無法更新條件")
                      }
                    />
                    <span
                      className={
                        criterion.met
                          ? "text-neutral-400 line-through dark:text-neutral-500"
                          : "text-neutral-700 dark:text-neutral-200"
                      }
                    >
                      {criterion.text}
                    </span>
                    {criterion.required ? (
                      <span className="rounded bg-neutral-100 px-1 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        必要
                      </span>
                    ) : (
                      <span className="text-[10px] text-neutral-400 dark:text-neutral-500">選填</span>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => deleteCriterion(criterion.id), "無法刪除條件")}
                        className="text-neutral-300 hover:text-red-600 dark:text-neutral-600"
                        aria-label="刪除條件"
                      >
                        <X size={12} />
                      </button>
                    )}
                    <CriterionApprovers
                      criterion={criterion}
                      staff={staff}
                      canManage={canManage && !decided}
                      busy={busy}
                      run={run}
                    />
                  </li>
                ))}
              </ul>
            )}
            {canManage && !decided && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={criterionText}
                  onChange={(e) => setCriterionText(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter" || !criterionText.trim()) return;
                    const ok = await run(
                      () => addCriterion(gate.id, criterionText, criterionRequired, null),
                      "無法新增條件"
                    );
                    if (ok) setCriterionText("");
                  }}
                  placeholder="新增條件,例如 可靠度測試報告已簽署"
                  className="min-w-0 flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500"
                />
                <label className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  <input
                    type="checkbox"
                    checked={criterionRequired}
                    onChange={(e) => setCriterionRequired(e.target.checked)}
                  />
                  必要
                </label>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">簽核人</p>
            {gate.approvers.length === 0 ? (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                還沒有簽核人——沒有簽核人的閘門只是一張清單,不能放行。
              </p>
            ) : (
              <ul className="space-y-1">
                {gate.approvers.map((approver) => (
                  <li key={approver.userId} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 truncate text-neutral-700 dark:text-neutral-200">
                      {approver.userName}
                    </span>
                    {approver.decision === "APPROVED" ? (
                      <span className="flex items-center gap-0.5 text-green-600">
                        <Check size={12} /> 同意
                      </span>
                    ) : approver.decision === "REJECTED" ? (
                      <span className="flex items-center gap-0.5 text-red-600">
                        <X size={12} /> 不同意
                      </span>
                    ) : (
                      <span className="text-neutral-400 dark:text-neutral-500">未表態</span>
                    )}
                    {approver.decidedAt && (
                      <span className="tabular-nums text-neutral-400 dark:text-neutral-500">
                        {withWeekday(approver.decidedAt.slice(0, 10))}
                      </span>
                    )}
                    {approver.comment && (
                      <span className="min-w-0 flex-1 truncate text-neutral-500 dark:text-neutral-400">
                        {approver.comment}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canManage && !decided && (
              <UserSelect
                users={staff.filter((u) => !gate.approvers.some((a) => a.userId === u.id))}
                value=""
                disabled={busy}
                placeholder="加入簽核人…"
                onChange={(userId) => {
                  if (!userId) return;
                  const next = [...gate.approvers.map((a) => a.userId), userId];
                  run(() => setApprovers(gate.id, next), "無法加入簽核人");
                }}
                className="mt-2 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500"
              />
            )}
          </div>

          {mine && gate.status === "PENDING" && (
            <div className="rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 p-2">
              <p className="mb-1.5 text-xs font-medium text-blue-900 dark:text-blue-200">
                你是這個閘門的簽核人{mine.decision && "(可以改)"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={signComment}
                  onChange={(e) => setSignComment(e.target.value)}
                  placeholder="意見(選填)"
                  className="min-w-0 flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => signGate(gate.id, "APPROVED", signComment), "無法簽核")}
                  className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
                >
                  同意
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => signGate(gate.id, "REJECTED", signComment), "無法簽核")}
                  className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
                >
                  不同意
                </button>
              </div>
            </div>
          )}

          {gate.status === "PENDING" && !gate.canPass && canManage && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              目前不能直接放行:{gate.blockers.join("、")}。
            </p>
          )}
        </div>
      )}
    </li>
  );
}
