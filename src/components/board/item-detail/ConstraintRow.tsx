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
import { DateWeekdayHint } from "@/components/ui/DateWeekdayHint";
import { useDialogs } from "@/components/ui/DialogProvider";

const NONE = "__none__";
const SOURCE_FIXED = "FIXED";
const SOURCE_PRED = "PRED";

const HINTS: Record<ItemConstraintType, string> = {
  START_NO_EARLIER_THAN: "前置算出的開始日若早於這天,會被推到這天",
  FINISH_NO_LATER_THAN: "期限。不會改動排程,只在超過時提出警告",
  MUST_FINISH_ON: "完成日固定在這天,開始日往回推算",
};

const selectClass =
  "rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

/**
 * The item card's 日期約束 row. A constraint is a type and a date together —
 * neither means anything alone. The date comes from one of two places (來源):
 *
 *  - 固定日期: the person picks a day.
 *  - 前置任務: one of this item's predecessors (Pred), at its 起始時間, its 結束時間,
 *    or any one day of its period (期間內的第 N 天). The predecessor moves, the
 *    constraint date moves with it.
 */
export function ConstraintRow({
  itemId,
  type,
  date,
  refItemId = null,
  refEdge = null,
  refDay = null,
  canEdit,
  currentEnd,
  durationDays,
  className = "border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5",
}: {
  itemId: string;
  type: ItemConstraintType | null;
  date: string | null;
  /** 約束日期跟著這個前置任務;null = 固定日期。 */
  refItemId?: string | null;
  refEdge?: ConstraintRefEdge | null;
  /** refEdge 為 DAY 時:前置任務期間的第幾天(從 1 算起)。 */
  refDay?: number | null;
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
    ? { kind: "PRED", predItemId: refItemId!, edge: refEdge!, day: refDay ?? undefined }
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
  }, [itemId, wantsPreds, date, refItemId, refEdge, refDay]);
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

  const disabled = !canEdit || saving;
  const noPreds = predecessors.length === 0 && !followsPred;

  // ---- 來源:固定日期 / 前置任務 ----
  function onSourceChange(value: string) {
    if (!draftType) return;
    if (value === SOURCE_FIXED) {
      // 從「前置任務」改回固定日期:先固定在目前那一天,再自己改。
      if (date) save(draftType, { kind: "FIXED", date });
      return;
    }
    // 改成前置任務:先選第一個前置任務的起始時間(之後再改位置或換前置任務)。
    const first = predecessors.find((p) => p.start) ?? predecessors[0];
    if (first) save(draftType, { kind: "PRED", predItemId: first.itemId, edge: "START" });
  }

  function onPredChange(predItemId: string) {
    if (!draftType || !followsPred) return;
    const next = predecessors.find((p) => p.itemId === predItemId);
    if (!next) return;
    // 換前置任務:位置照舊;第 N 天要落在新前置任務的期間裡。
    const day = refEdge === "DAY" ? Math.min(refDay ?? 1, Math.max(next.days.length, 1)) : undefined;
    save(draftType, { kind: "PRED", predItemId, edge: refEdge!, day });
  }

  function onPositionChange(edge: ConstraintRefEdge) {
    if (!draftType || !followsPred) return;
    save(draftType, { kind: "PRED", predItemId: refItemId!, edge, day: edge === "DAY" ? (refDay ?? 1) : undefined });
  }

  function onDayChange(day: number) {
    if (!draftType || !followsPred) return;
    save(draftType, { kind: "PRED", predItemId: refItemId!, edge: "DAY", day });
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">日期約束</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <select
            value={draftType ?? NONE}
            disabled={disabled}
            onChange={(e) => {
              const next = e.target.value === NONE ? null : (e.target.value as ItemConstraintType);
              setDraftType(next);
              // Clearing takes effect at once; a new type waits for its date.
              if (!next) save(null, null);
              else if (storedSource) save(next, storedSource);
            }}
            className={selectClass}
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
              value={followsPred ? SOURCE_PRED : SOURCE_FIXED}
              disabled={disabled}
              onChange={(e) => onSourceChange(e.target.value)}
              className={selectClass}
            >
              <option value={SOURCE_FIXED}>固定日期</option>
              {/* 沒有前置任務也列出來(灰的):看得到有這個選項,也知道要先在 Pred 設定前置任務。 */}
              <option value={SOURCE_PRED} disabled={noPreds}>
                {noPreds ? "前置任務(先在 Pred 設定前置任務)" : "前置任務"}
              </option>
            </select>
          )}

          {draftType && followsPred && (
            <>
              <select
                data-constraint-pred
                value={refItemId ?? ""}
                disabled={disabled}
                onChange={(e) => onPredChange(e.target.value)}
                className={`${selectClass} max-w-[14rem]`}
              >
                {/* 選單還沒載入、但目前正跟著的前置任務,先放著,不然下拉會空白。 */}
                {!followed && <option value={refItemId ?? ""}>(載入中…)</option>}
                {predecessors.map((p) => (
                  <option key={p.itemId} value={p.itemId}>
                    {predLabel(p)}
                  </option>
                ))}
              </select>
              <select
                data-constraint-position
                value={refEdge ?? "START"}
                disabled={disabled}
                onChange={(e) => onPositionChange(e.target.value as ConstraintRefEdge)}
                className={selectClass}
              >
                <option value="START" disabled={!!followed && !followed.start}>
                  {CONSTRAINT_REF_EDGE_LABELS.START}
                  {followed?.start ? `(${withWeekday(followed.start)})` : ""}
                </option>
                <option value="FINISH" disabled={!!followed && !followed.end}>
                  {CONSTRAINT_REF_EDGE_LABELS.FINISH}
                  {followed?.end ? `(${withWeekday(followed.end)})` : ""}
                </option>
                <option value="DAY" disabled={!!followed && followed.days.length === 0}>
                  {CONSTRAINT_REF_EDGE_LABELS.DAY}
                </option>
              </select>
              {refEdge === "DAY" && (
                <select
                  data-constraint-day
                  value={refDay ?? 1}
                  disabled={disabled}
                  onChange={(e) => onDayChange(Number(e.target.value))}
                  className={selectClass}
                >
                  {(followed?.days ?? []).map((day, i) => (
                    <option key={day} value={i + 1}>
                      第 {i + 1} 天・{withWeekday(day)}
                    </option>
                  ))}
                  {/* 前置任務的期間縮短、或還沒載入:存著的第 N 天先留著,選單才不會空。 */}
                  {(followed?.days ?? []).length < (refDay ?? 1) && <option value={refDay ?? 1}>第 {refDay ?? 1} 天</option>}
                </select>
              )}
              <span data-constraint-followed-date className="text-sm text-neutral-800 dark:text-neutral-100">
                {date ? `= ${withWeekday(date)}` : "(前置任務還沒有日期)"}
              </span>
            </>
          )}

          {draftType && !followsPred && (
            <>
              <input
                type="date"
                value={date ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  e.target.value ? save(draftType, { kind: "FIXED", date: e.target.value }) : save(null, null)
                }
                className={selectClass}
              />
              <DateWeekdayHint value={date} />
            </>
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
                ? `日期跟著前置任務${followed ? `「${predLabel(followed)}」` : ""}的${
                    refEdge === "DAY" ? `期間第 ${refDay ?? 1} 天` : CONSTRAINT_REF_EDGE_LABELS[refEdge!]
                  }走,它一動這裡就跟著動。${HINTS[draftType]}`
                : date
                  ? HINTS[draftType]
                  : noPreds
                    ? "請選擇約束日期(想跟著前置任務的日期走,先在 Pred 設定前置任務)"
                    : "請選擇約束日期,或把來源改成前置任務")}
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
