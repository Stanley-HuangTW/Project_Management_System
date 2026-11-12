"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ItemConstraintType } from "@prisma/client";
import { getConstraintConflict, getConstraintPredecessors, setItemConstraint } from "@/lib/actions/constraint";
import {
  CONSTRAINT_LABELS,
  CONSTRAINT_REF_EDGE_LABELS,
  applyConstraint,
  type ConstraintRefEdge,
  type ConstraintSourceInput,
} from "@/lib/constraints";
import type { ItemPredecessor } from "@/lib/predecessorLink";
import { withWeekday } from "@/lib/weekdayLabel";
import { useDialogs } from "@/components/ui/DialogProvider";

const NONE = "__none__";
const FIXED = "FIXED";

const HINTS: Record<ItemConstraintType, string> = {
  START_NO_EARLIER_THAN: "前置算出的開始日若早於這天,會被推到這天",
  FINISH_NO_LATER_THAN: "期限。不會改動排程,只在超過時提出警告",
  MUST_FINISH_ON: "完成日固定在這天,開始日往回推算",
};

/** 下拉選單裡「前置任務的某一端」的值:PRED|<前置任務 id>|START 或 FINISH。 */
const predValue = (itemId: string, edge: ConstraintRefEdge) => `PRED|${itemId}|${edge}`;

/**
 * The item card's 日期約束 row. A constraint is a type and a date together —
 * neither means anything alone. The date is either one the person picks (固定日期)
 * or follows one end of a predecessor (前置任務的開始日 / 完成日): the predecessor
 * moves, the constraint date moves with it.
 */
export function ConstraintRow({
  itemId,
  type,
  date,
  refItemId = null,
  refEdge = null,
  canEdit,
  currentEnd,
  durationDays,
  className = "border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5",
}: {
  itemId: string;
  type: ItemConstraintType | null;
  date: string | null;
  /** 約束日期跟著這個前置任務的 refEdge 那一端;null = 固定日期。 */
  refItemId?: string | null;
  refEdge?: ConstraintRefEdge | null;
  canEdit: boolean;
  /** The item's current finish, for showing whether a deadline is being met. */
  currentEnd: string | null;
  durationDays: number | null;
  /** 外框的樣式——項目卡片裡是帶底線的一列,別處(人員分配視窗)要自己排版時覆蓋。 */
  className?: string;
}) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [saving, setSaving] = useState(false);
  // A constraint is a type AND a date; picking the type first is the natural
  // order, so hold it here and reveal the date field rather than rejecting a
  // half-filled constraint the user is still in the middle of entering.
  const [draftType, setDraftType] = useState<ItemConstraintType | null>(type);
  const [prevType, setPrevType] = useState(type);
  if (type !== prevType) {
    setPrevType(type);
    setDraftType(type);
  }

  async function save(nextType: ItemConstraintType | null, source: ConstraintSourceInput | null) {
    setSaving(true);
    try {
      const result = await setItemConstraint(itemId, nextType, source);
      if (result.error) {
        await notify(result.error, { title: "無法設定日期約束" });
        return;
      }
      router.refresh();
      // Saved, but the predecessors can't meet it — the row keeps saying so too.
      if (result.warning) await notify(result.warning, { title: "日期約束衝突" });
    } finally {
      setSaving(false);
    }
  }

  // 目前存著的來源:跟著前置任務,或固定日期。
  const followsPred = !!type && !!refItemId && !!refEdge;
  const storedSource: ConstraintSourceInput | null = followsPred
    ? { kind: "PRED", predItemId: refItemId!, edge: refEdge! }
    : date
      ? { kind: "FIXED", date }
      : null;

  // 這個項目 Pred 裡有哪些前置任務可以跟著走——問伺服器,因為前置任務可能在別的分組、別的看板。
  // 選了約束類型才需要;前置任務的日期一變(存檔後畫面重新整理)再問一次,選單上的日期才是最新的。
  const [predecessors, setPredecessors] = useState<ItemPredecessor[]>([]);
  const wantsPreds = canEdit && !!draftType;
  useEffect(() => {
    if (!wantsPreds) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await getConstraintPredecessors(itemId);
        if (!cancelled) setPredecessors(list);
      } catch {
        if (!cancelled) setPredecessors([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, wantsPreds, date, refItemId, refEdge]);
  const followed = followsPred ? predecessors.find((p) => p.itemId === refItemId) : undefined;
  const predLabel = (p: ItemPredecessor) => `${`${p.wbsCode} ${p.name}`.trim()}${p.boardName ? `(${p.boardName})` : ""}`;

  // 釘住完成日的項目,前置依賴是不是排得進去——問伺服器,因為前置依賴可能在別的分組、別的看板。
  // 約束、日期或天數一變(存檔後畫面重新整理)就再問一次。
  const pinned = type === "MUST_FINISH_ON" && !!date;
  const [conflict, setConflict] = useState<string | null>(null);
  useEffect(() => {
    if (!pinned) return;
    let cancelled = false;
    void (async () => {
      try {
        const message = await getConstraintConflict(itemId);
        if (!cancelled) setConflict(message);
      } catch {
        if (!cancelled) setConflict(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, pinned, date, currentEnd, durationDays]);
  const shownConflict = pinned ? conflict : null;

  // Only a deadline can be missed; the other two move the item instead.
  const violation =
    type && date && currentEnd
      ? applyConstraint(
          { start: new Date(currentEnd), end: new Date(currentEnd) },
          durationDays,
          { type, date },
          "CALENDAR",
          new Set()
        ).violation
      : null;

  // 完成日釘住了,但沒有天數可以往回推:開始日、Start / Days 都還是空的,說一聲為什麼。
  const missingLength = type === "MUST_FINISH_ON" && !!date && durationDays === null;

  // 日期欄位的內容:跟著前置任務時是唯讀的日期,固定日期時是日期輸入框。
  const sourceValue = followsPred ? predValue(refItemId!, refEdge!) : FIXED;

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">日期約束</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <select
            value={draftType ?? NONE}
            disabled={!canEdit || saving}
            onChange={(e) => {
              const next = e.target.value === NONE ? null : (e.target.value as ItemConstraintType);
              setDraftType(next);
              // Clearing takes effect at once; a new type waits for its date.
              if (!next) save(null, null);
              else if (storedSource) save(next, storedSource);
            }}
            className="rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
          >
            <option value={NONE}>無</option>
            {(Object.keys(CONSTRAINT_LABELS) as ItemConstraintType[]).map((key) => (
              <option key={key} value={key}>
                {CONSTRAINT_LABELS[key]}
              </option>
            ))}
          </select>
          {draftType && (
            <select
              data-constraint-source
              value={sourceValue}
              disabled={!canEdit || saving}
              onChange={(e) => {
                const value = e.target.value;
                if (value === FIXED) {
                  // 從「跟著前置任務」改回固定日期:先固定在目前那一天,再自己改。
                  if (date) save(draftType, { kind: "FIXED", date });
                  return;
                }
                const [, predItemId, edge] = value.split("|");
                save(draftType, { kind: "PRED", predItemId, edge: edge as ConstraintRefEdge });
              }}
              className="max-w-[16rem] rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value={FIXED}>固定日期</option>
              {/* 選單上還沒載入到、但目前正跟著的前置任務,先放著,不然下拉會顯示成「固定日期」。 */}
              {followsPred && !followed && (
                <option value={predValue(refItemId!, refEdge!)}>前置任務的{CONSTRAINT_REF_EDGE_LABELS[refEdge!]}</option>
              )}
              {predecessors.flatMap((p) =>
                (["START", "FINISH"] as ConstraintRefEdge[]).map((edge) => {
                  const day = edge === "START" ? p.start : p.end;
                  return (
                    <option key={`${p.itemId}-${edge}`} value={predValue(p.itemId, edge)} disabled={!day}>
                      前置 {predLabel(p)} 的{CONSTRAINT_REF_EDGE_LABELS[edge]}
                      {day ? `(${withWeekday(day)})` : "(還沒有日期)"}
                    </option>
                  );
                })
              )}
            </select>
          )}
          {draftType && !followsPred && (
            <input
              type="date"
              value={date ?? ""}
              disabled={!canEdit || saving}
              onChange={(e) =>
                e.target.value ? save(draftType, { kind: "FIXED", date: e.target.value }) : save(null, null)
              }
              className="rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
            />
          )}
          {draftType && followsPred && (
            <span data-constraint-followed-date className="text-sm text-neutral-800 dark:text-neutral-100">
              {date ? withWeekday(date) : "(前置任務還沒有日期)"}
            </span>
          )}
        </div>
      </div>
      {draftType && (
        <p
          className={`mt-1 text-right text-xs ${
            violation ? "text-red-600" : "text-neutral-400 dark:text-neutral-500"
          }`}
        >
          {violation ??
            (missingLength
              ? "還沒有天數,填了天數(自動排程的看板填手動天數欄位)才算得出開始日"
              : followsPred
                ? `日期跟著前置任務${followed ? `「${predLabel(followed)}」` : ""}的${CONSTRAINT_REF_EDGE_LABELS[refEdge!]}走,它一動這裡就跟著動。${HINTS[draftType]}`
                : date
                  ? HINTS[draftType]
                  : predecessors.length > 0
                    ? "請選擇約束日期,或改成跟著前置任務的開始日 / 完成日"
                    : "請選擇約束日期(想跟著前置任務的日期走,先在 Pred 設定前置任務)")}
        </p>
      )}
      {shownConflict && (
        <p data-constraint-conflict className="mt-1 text-right text-xs text-red-600">
          {shownConflict}
        </p>
      )}
    </div>
  );
}
