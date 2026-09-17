"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { daysBetween, endFromDays, type DurationMode } from "@/lib/rangeDuration";

export type RangeDraft = {
  /** 里程碑才有:排在哪一排。 */
  typeId?: string;
  name: string;
  startDate: string;
  endDate: string;
  color: string;
};

export type MilestoneTypeOption = { id: string; name: string };

/** 挑好的一組顏色:丟一個完整色票給人選,選得出看不見的顏色。 */
const COLORS = ["#fdab3d", "#00c875", "#579bfc", "#a25ddc", "#e2445c", "#787d80"];

/**
 * 階段與里程碑的期間設定。
 *
 * 一個畫面問完,而且日期用 date 輸入 —— 原本是連續兩個文字提示,要自己
 * 記得格式,而且填到第二個才發現第一個打錯就得整個重來。起訖日本來就是
 * 一起決定的,拆成兩步只是把一件事變成兩件。
 */
export function PhaseRangeDialog({
  open,
  onOpenChange,
  title,
  /** 有值 = 編輯既有的;沒有 = 新增。 */
  initial,
  /** 里程碑要多選一個類型;給了清單就是里程碑。 */
  types,
  holidays = [],
  onManageTypes,
  /** 編輯既有的才給 —— 刪除鍵跟著出現在同一個畫面上。 */
  onDelete,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial?: RangeDraft;
  types?: MilestoneTypeOption[];
  /** 算工作天要扣掉的國定假日。 */
  holidays?: string[];
  onManageTypes?: () => void;
  onDelete?: () => void;
  onSubmit: (draft: RangeDraft) => void;
}) {
  const [typeId, setTypeId] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [durationMode, setDurationMode] = useState<DurationMode>("calendar");
  const [days, setDays] = useState("");
  const [error, setError] = useState<string | null>(null);

  const holidaySet = useMemo(() => new Set(holidays), [holidays]);

  /**
   * 天數與結束日是同一件事的兩種寫法,所以改哪一邊都要把另一邊算出來。
   *
   * 三支各自處理,而不是放一個 effect 去同步:effect 版本分不出「使用者改
   * 的是哪一欄」,只能兩邊互推,結果是游標在天數欄裡打到一半就被結束日推
   * 回來。
   */
  function changeStart(next: string) {
    setStartDate(next);
    const n = Number(days);
    if (days.trim() !== "" && Number.isFinite(n) && n >= 1) {
      setEndDate(endFromDays(next, n, durationMode, holidaySet) ?? "");
      return;
    }
    setDays(String(daysBetween(next, endDate, durationMode, holidaySet) ?? ""));
  }

  function changeEnd(next: string) {
    setEndDate(next);
    setDays(String(daysBetween(startDate, next, durationMode, holidaySet) ?? ""));
  }

  function changeDays(next: string) {
    setDays(next);
    const n = Number(next);
    if (next.trim() === "" || !Number.isFinite(n) || n < 1) return;
    const end = endFromDays(startDate, n, durationMode, holidaySet);
    if (end) setEndDate(end);
  }

  /** 換算法的時候日期不動,重新換算天數 —— 同一段期間的工作天比日曆天少。 */
  function changeMode(next: DurationMode) {
    setDurationMode(next);
    setDays(String(daysBetween(startDate, endDate, next, holidaySet) ?? ""));
  }

  // 每次打開都對齊當下的 initial —— 沿用上一次開啟留下的值會把別的階段的
  // 日期帶進來。在 render 當下調整而不是放進 effect:effect 版本會先用舊值
  // 畫一次再改,而且 react-hooks 的規則也擋。
  const key = open ? `${title}|${initial?.name ?? ""}|${initial?.startDate ?? ""}` : null;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (key !== prevKey) {
    setPrevKey(key);
    setTypeId(initial?.typeId ?? types?.[0]?.id ?? "");
    setName(initial?.name ?? "");
    setStartDate(initial?.startDate ?? "");
    setEndDate(initial?.endDate ?? "");
    setColor(initial?.color ?? COLORS[0]);
    setDays(
      initial?.startDate && initial?.endDate
        ? String(daysBetween(initial.startDate, initial.endDate, durationMode, holidaySet) ?? "")
        : ""
    );
    setError(null);
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError("名稱不可為空");
    if (types && !typeId) return setError("請先新增一個里程碑類型");
    if (!startDate || !endDate) return setError("起訖日期都要選");
    if (endDate < startDate) return setError("結束日不可早於開始日");
    onSubmit({
      ...(types ? { typeId } : {}),
      name: trimmed,
      startDate,
      endDate,
      color,
    });
    onOpenChange(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-3">
        {types && (
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
              類型(同一個類型排在同一排)
              {onManageTypes && (
                <button
                  type="button"
                  onClick={onManageTypes}
                  className="rounded px-1 py-0.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                >
                  管理類型
                </button>
              )}
            </span>
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={field}>
              {types.length === 0 && <option value="">(還沒有類型,請先新增)</option>}
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">名稱</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={types ? "例如 PCBA 打件、機構出圖" : "例如 EFS、EVT、DVT1"}
            className={field}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">開始日</span>
            <input
              type="date"
              value={startDate}
              // 刻意沒有 max:填了天數之後,把開始日往後挪是合理的(結束日
              // 會跟著走),用結束日把它鎖住反而擋掉正常的編輯。順序不對
              // 由送出時的檢查擋。
              onChange={(e) => changeStart(e.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">結束日</span>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => changeEnd(e.target.value)}
              className={field}
            />
          </label>
        </div>

        <div className="flex items-end gap-3">
          <label className="block w-28">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">天數</span>
            <input
              value={days}
              onChange={(e) => changeDays(e.target.value)}
              inputMode="numeric"
              placeholder="—"
              className={field}
            />
          </label>
          <div className="flex overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-600">
            {(
              [
                ["calendar", "日曆天"],
                ["business", "工作天"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => changeMode(value)}
                className={`px-2.5 py-1.5 ${
                  durationMode === value
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "bg-white text-neutral-600 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="pb-2 text-[11px] text-neutral-400 dark:text-neutral-500">
            {durationMode === "business" ? "不含週末與國定假日" : "含週末"}
          </p>
        </div>

        <div>
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">顏色</span>
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={c}
                className={`h-6 w-6 rounded ${
                  color === c ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-neutral-900" : ""
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {startDate && endDate && endDate >= startDate && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            日曆天 {daysBetween(startDate, endDate, "calendar", holidaySet)} 天・工作天{" "}
            {daysBetween(startDate, endDate, "business", holidaySet)} 天
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {/* 刪除放在這裡,而不是只藏在表格右緣的小垃圾桶 —— 要刪的人是從
              這個畫面進來的。離「確定」有一段距離,不會順手按到。 */}
          {onDelete ? (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onDelete();
              }}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
            >
              刪除
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              確定
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
