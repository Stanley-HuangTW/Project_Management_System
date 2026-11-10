"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  BOM_COLUMN_TYPES,
  BOM_COLUMN_TYPE_LABELS,
  MAX_BOM_COLUMNS,
  MONEY_BLOCK_NAME,
  isBuiltInColumn,
  isMoneyBlock,
  newColumnId,
  validateBomColumns,
  type BomColumnDef,
  type BomColumnType,
} from "@/lib/bomColumns";
import { actionErrorMessage } from "@/lib/userError";

/** 編輯中的一個欄位:選項與預設值先當文字、勾選先當布林,存檔時才整理回正式的樣子。 */
type Draft = {
  id: string;
  name: string;
  type: BomColumnType;
  /** 下拉選單的選項,一行一個。 */
  optionsText: string;
  required: boolean;
  visible: boolean;
  defaultText: string;
  defaultChecked: boolean;
  /** 這個欄位原本就存在(已經存過):類型不能改,刪除要確認——它的值是真的資料。 */
  saved: boolean;
};

function toDraft(c: BomColumnDef, saved: boolean): Draft {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    optionsText: c.options.join("\n"),
    required: c.required,
    visible: c.visible,
    defaultText: typeof c.defaultValue === "string" || typeof c.defaultValue === "number" ? String(c.defaultValue) : "",
    defaultChecked: c.defaultValue === true,
    saved,
  };
}

function fromDraft(d: Draft): BomColumnDef {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    options: d.type === "SELECT" ? d.optionsText.split("\n").map((o) => o.trim()).filter(Boolean) : [],
    required: d.required,
    defaultValue: d.type === "CHECKBOX" ? (d.defaultChecked ? true : null) : d.defaultText.trim() === "" ? null : d.defaultText,
    visible: d.visible,
  };
}

const fieldClass =
  "rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

/**
 * BOM 的欄位設定:加自訂欄位(文字、數字、日期、下拉選單、人員、勾選、連結)、改名、隱藏、換順序、
 * 設必填與新增時的預設值。看板自己用、系統設定的「BOM 預設欄位」也用——存到哪裡由 onSave 決定。
 *
 * 「金額欄位」(數量、單價、幣別、小計)算成本用,固定在清單裡,只能換位置。
 */
export function BomColumnsDialog({
  open,
  onOpenChange,
  title,
  intro,
  columns,
  onSave,
  onReset,
  resetLabel = "恢復預設",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  intro: string;
  columns: BomColumnDef[];
  /** 存檔。回傳 null = 成功;字串 = 要顯示給使用者的原因。 */
  onSave: (columns: BomColumnDef[]) => Promise<string | null>;
  /** 有的話,多一個「恢復」按鈕(看板:改回沿用系統預設;系統預設:恢復內建)。 */
  onReset?: () => Promise<string | null>;
  resetLabel?: string;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="xl">
      {open && <Editor intro={intro} columns={columns} onSave={onSave} onReset={onReset} resetLabel={resetLabel} onDone={() => onOpenChange(false)} />}
    </Modal>
  );
}

function Editor({
  intro,
  columns,
  onSave,
  onReset,
  resetLabel,
  onDone,
}: {
  intro: string;
  columns: BomColumnDef[];
  onSave: (columns: BomColumnDef[]) => Promise<string | null>;
  onReset?: () => Promise<string | null>;
  resetLabel: string;
  onDone: () => void;
}) {
  const { confirm } = useDialogs();
  const [drafts, setDrafts] = useState<Draft[]>(() => columns.map((c) => toDraft(c, true)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (index: number, change: Partial<Draft>) => setDrafts((cur) => cur.map((d, i) => (i === index ? { ...d, ...change } : d)));
  const move = (index: number, delta: -1 | 1) =>
    setDrafts((cur) => {
      const target = index + delta;
      if (target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  function add() {
    setDrafts((cur) => [
      ...cur,
      { id: newColumnId(), name: "", type: "TEXT", optionsText: "", required: false, visible: true, defaultText: "", defaultChecked: false, saved: false },
    ]);
  }

  async function remove(index: number) {
    const d = drafts[index];
    if (d.saved) {
      const ok = await confirm(`刪除欄位「${d.name}」?這個欄位在每一列填的值會一併刪掉,無法復原。(只是不想看到的話,取消勾選「顯示」就好。)`, {
        title: "刪除欄位",
        confirmLabel: "刪除",
        danger: true,
      });
      if (!ok) return;
    }
    setDrafts((cur) => cur.filter((_, i) => i !== index));
  }

  async function save() {
    const next = drafts.map(fromDraft);
    const checked = validateBomColumns(next);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const failure = await onSave(checked.value);
      if (failure) setError(failure);
      else onDone();
    } catch (err) {
      setError(actionErrorMessage(err, "儲存失敗"));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!onReset) return;
    const ok = await confirm(`${resetLabel}?目前這份設定會被取代;已經不在新設定裡的自訂欄位,它的值會一併刪掉。`, {
      title: resetLabel,
      confirmLabel: "確定",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const failure = await onReset();
      if (failure) setError(failure);
      else onDone();
    } catch (err) {
      setError(actionErrorMessage(err, "操作失敗"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-bom-columns-editor>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {intro} 欄位由上到下就是表格由左到右的順序;「名稱」與「BOM LEVEL」固定在最前面。<b>必填</b>只會把沒填的格子標成黃色、統計缺幾列,不會擋存檔。
        <b>預設值</b>是新增一列時自動帶的值。
      </p>

      <ul className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
        {/* 名稱與 BOM LEVEL 永遠在最前面,不能改名、隱藏、刪除或換位置;列出來是讓人知道表格最前面是哪兩欄。 */}
        {[
          { key: "name", label: "名稱", note: "(固定在表格最前面,不能改名、隱藏或移動)" },
          { key: "level", label: "BOM LEVEL", note: "(階層,固定在名稱後面,不能改名、隱藏或移動)" },
        ].map((f) => (
          <li key={f.key} data-bom-fixed-column={f.key} className="rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/50">
            <div className="flex items-center gap-2">
              <span className="w-[13px] shrink-0" />
              <span className="min-w-0 flex-1 text-sm text-neutral-500 dark:text-neutral-400">
                {f.label}
                <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">{f.note}</span>
              </span>
            </div>
          </li>
        ))}
        {drafts.map((d, index) => {
          const money = isMoneyBlock(d);
          const builtIn = isBuiltInColumn(d);
          return (
            <li key={d.id} data-bom-column-row={d.id} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex shrink-0 flex-col">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} title="往前" aria-label="往前" className="text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200">
                    <ArrowUp size={13} />
                  </button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === drafts.length - 1} title="往後" aria-label="往後" className="text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200">
                    <ArrowDown size={13} />
                  </button>
                </span>

                {money ? (
                  <span className="min-w-0 flex-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {MONEY_BLOCK_NAME}
                    <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">(算成本用,固定在表格裡,只能換位置)</span>
                  </span>
                ) : (
                  <>
                    <input
                      value={d.name}
                      onChange={(e) => patch(index, { name: e.target.value })}
                      placeholder="欄位名稱"
                      maxLength={30}
                      aria-label="欄位名稱"
                      data-bom-column-name
                      className={`${fieldClass} w-40`}
                    />
                    {builtIn || d.saved ? (
                      <span className="w-20 shrink-0 text-xs text-neutral-500 dark:text-neutral-400" title={builtIn ? "內建欄位的類型固定" : "已經存過的欄位不能換類型"}>
                        {BOM_COLUMN_TYPE_LABELS[d.type]}
                        {builtIn && "(內建)"}
                      </span>
                    ) : (
                      <select
                        value={d.type}
                        onChange={(e) => patch(index, { type: e.target.value as BomColumnType })}
                        aria-label="欄位類型"
                        data-bom-column-type
                        className={`${fieldClass} w-28`}
                      >
                        {BOM_COLUMN_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {BOM_COLUMN_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="flex shrink-0 items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300">
                      <input type="checkbox" checked={d.visible} onChange={(e) => patch(index, { visible: e.target.checked })} data-bom-column-visible />
                      顯示
                    </label>
                    <label className="flex shrink-0 items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300">
                      <input type="checkbox" checked={d.required} onChange={(e) => patch(index, { required: e.target.checked })} data-bom-column-required />
                      必填
                    </label>
                    {d.type !== "PERSON" && d.type !== "FILE" && (
                      <span className="flex min-w-0 flex-1 items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300">
                        預設值
                        {d.type === "CHECKBOX" ? (
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={d.defaultChecked} onChange={(e) => patch(index, { defaultChecked: e.target.checked })} />
                            預設勾選
                          </label>
                        ) : d.type === "SELECT" ? (
                          <select value={d.defaultText} onChange={(e) => patch(index, { defaultText: e.target.value })} aria-label="預設值" className={`${fieldClass} min-w-0 flex-1`}>
                            <option value="">(沒有)</option>
                            {d.optionsText
                              .split("\n")
                              .map((o) => o.trim())
                              .filter(Boolean)
                              .map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <input
                            type={d.type === "DATE" ? "date" : "text"}
                            inputMode={d.type === "NUMBER" ? "decimal" : undefined}
                            value={d.defaultText}
                            onChange={(e) => patch(index, { defaultText: e.target.value })}
                            aria-label="預設值"
                            placeholder={d.id === "delivery" ? "(沒有)例如 8" : "(沒有)"}
                            className={`${fieldClass} min-w-0 flex-1`}
                          />
                        )}
                        {d.id === "delivery" && <span className="shrink-0">週</span>}
                      </span>
                    )}
                    {!builtIn && (
                      <button type="button" onClick={() => void remove(index)} title="刪除欄位" aria-label="刪除欄位" data-bom-column-delete className="shrink-0 text-neutral-300 hover:text-red-600 dark:text-neutral-600">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
              {!money && d.type === "SELECT" && (
                <label className="mt-2 block text-xs text-neutral-500 dark:text-neutral-400">
                  選項(一行一個)
                  <textarea
                    value={d.optionsText}
                    onChange={(e) => patch(index, { optionsText: e.target.value })}
                    rows={Math.min(6, Math.max(2, d.optionsText.split("\n").length))}
                    data-bom-column-options
                    placeholder={"未送樣\n已送樣\n通過"}
                    className={`${fieldClass} mt-1 w-full resize-none`}
                  />
                </label>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={add}
          disabled={drafts.length >= MAX_BOM_COLUMNS}
          data-bom-column-add
          className="flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          <Plus size={12} /> 新增欄位
        </button>
        {error && (
          <p data-bom-columns-error className="min-w-0 flex-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
        {onReset ? (
          <button type="button" onClick={() => void reset()} disabled={busy} className="text-xs text-neutral-500 hover:text-neutral-800 hover:underline disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-100">
            {resetLabel}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onDone} disabled={busy} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800">
            取消
          </button>
          <button type="button" onClick={() => void save()} disabled={busy} data-bom-columns-save className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? "儲存中..." : "儲存"}
          </button>
        </div>
      </div>
    </div>
  );
}
