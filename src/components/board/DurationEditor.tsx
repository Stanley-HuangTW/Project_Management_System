"use client";

import { useRef, useState } from "react";
import { parseNumberInput } from "@/lib/cellValue";
import { previewSchedule } from "@/lib/actions/predecessorSchedule";
import type { SchedulePreview } from "@/lib/predecessorLink";
import { ScheduleChangePanel } from "./ScheduleChangePanel";

/**
 * 「改天數」的輸入框(項目卡片與人員分配視窗共用):一邊打、一邊在同一欄正下方即時算出
 * Start day / Finish day 會變成哪天(含星期幾),原來 → 更改後;按 Enter 或「確認套用」才真的儲存,
 * 「取消」或離開這一欄就取消、面板消失(Esc 是關掉整個視窗,未確認的編輯一樣不會儲存)。
 *
 * 不是每個數字欄都用這個——只有改了會讓日期變動的天數欄(一般看板的 Days、一律自動計算看板的手動天數)。
 */
export function DurationEditor({
  boardId,
  itemId,
  columnId,
  value,
  currentStart,
  currentEnd,
  disabled = false,
  inputClassName,
  onSave,
}: {
  boardId: string;
  itemId: string;
  columnId: string;
  value: number | null;
  /** 這個項目現在的 Start / Finish(面板的「原來」)。 */
  currentStart: string | null;
  currentEnd: string | null;
  disabled?: boolean;
  inputClassName: string;
  /** 確認後呼叫。回字串 = 被擋下的原因(面板留著並顯示),其他 = 成功。 */
  onSave: (next: number | null) => Promise<string | null | void> | void;
}) {
  const stored = value === null ? "" : String(value);
  const [text, setText] = useState(stored);
  // 儲存的數字被別處改掉(上一步 / 下一步、排程連動)時,輸入框跟著變。
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(stored);
  }
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 打得比伺服器算得快時,只認最後一次的結果。
  const requestId = useRef(0);

  const entered = parseNumberInput(text);
  const changed = entered !== value;
  const showPanel = editing && changed;

  function schedulePreview(nextText: string) {
    if (timer.current) clearTimeout(timer.current);
    const nextValue = parseNumberInput(nextText);
    setError(null);
    if (nextValue === value) {
      requestId.current++;
      setPreview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++requestId.current;
    timer.current = setTimeout(async () => {
      try {
        const result = await previewSchedule(boardId, itemId, columnId, nextValue);
        if (mine === requestId.current) setPreview(result);
      } catch {
        if (mine === requestId.current) setPreview(null);
      } finally {
        if (mine === requestId.current) setLoading(false);
      }
    }, 250);
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    requestId.current++;
    setText(stored);
    setPreview(null);
    setLoading(false);
    setError(null);
    setEditing(false);
  }

  async function confirm() {
    if (!changed) return cancel();
    if (timer.current) clearTimeout(timer.current);
    requestId.current++;
    setLoading(false);
    const result = await onSave(entered);
    if (typeof result === "string") {
      setError(result);
      return;
    }
    setPreview(null);
    setEditing(false);
  }

  return (
    <div className="relative">
      <input
        type="number"
        value={text}
        disabled={disabled}
        data-duration-editor
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setText(e.target.value);
          setEditing(true);
          schedulePreview(e.target.value);
        }}
        onBlur={cancel}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void confirm();
          }
          // Esc 不處理:對話框(Radix)在 document 上用 capture 聽 Esc,輸入框攔不住,Esc 一定是關掉整個視窗;
          // 未確認的編輯本來就不會儲存。要取消請按「取消」或離開這一欄。
        }}
        className={inputClassName}
      />
      {/* 貼在這一欄正下方、靠右對齊的浮動面板:欄位本身很窄(卡片裡 w-40),面板要寬一點才放得下兩個日期。 */}
      {showPanel && (
        <div className="absolute right-0 top-full z-20 w-80 max-w-[85vw] shadow-lg">
          <ScheduleChangePanel
            currentStart={currentStart}
            currentEnd={currentEnd}
            preview={preview}
            loading={loading}
            error={error}
            onConfirm={() => void confirm()}
            onCancel={cancel}
          />
        </div>
      )}
    </div>
  );
}
