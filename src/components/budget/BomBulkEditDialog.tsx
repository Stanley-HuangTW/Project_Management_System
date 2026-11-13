"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { BOM_COLUMN_TYPE_LABELS, isCustomColumn, isMoneyBlock, type BomColumnDef } from "@/lib/bomColumns";
import type { BulkEditField } from "@/lib/actions/bomBulk";
import { DateWeekdayHint } from "@/components/ui/DateWeekdayHint";

type FixedKind = "rename" | "qty" | "unitPrice" | "currency";
// 每一種固定欄位各自一個型別,kind 才能一個一個縮小範圍。
type Choice = { [K in FixedKind]: { key: string; label: string; kind: K } }[FixedKind] | { key: string; label: string; kind: "column"; column: BomColumnDef };

const inputClass =
  "w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

/**
 * 勾選之後「編輯…」:選一個欄位,把勾選的列(只有打勾的列本身,不連子項目)一次改成同一個值。
 * 要改的欄位有:取代名稱、數量、單價、幣別(含匯率)、這個看板 BOM 顯示的內建欄位(廠商、交期、備註)與自訂欄位。
 * 型號/料號與檔案附件不開放批次改(每一列都不一樣)。
 */
export function BomBulkEditDialog({
  open,
  onOpenChange,
  count,
  columns,
  users,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 勾選的列數。 */
  count: number;
  columns: BomColumnDef[];
  users: { id: string; name: string }[];
  /** 回傳錯誤說明就留在視窗;null = 成功,視窗關掉。 */
  onApply: (field: BulkEditField) => Promise<string | null>;
}) {
  const choices: Choice[] = [
    { key: "rename", label: "取代名稱", kind: "rename" },
    { key: "qty", label: "數量", kind: "qty" },
    { key: "unitPrice", label: "單價(零件)", kind: "unitPrice" },
    { key: "currency", label: "幣別(含匯率,零件)", kind: "currency" },
    ...columns
      .filter((c) => !isMoneyBlock(c) && c.id !== "partNumber" && c.type !== "FILE")
      .map((c): Choice => ({ key: `col:${c.id}`, label: isCustomColumn(c) ? `${c.name}(${BOM_COLUMN_TYPE_LABELS[c.type]})` : c.name, kind: "column", column: c })),
  ];

  const [choiceKey, setChoiceKey] = useState("rename");
  const [text, setText] = useState("");
  const [checked, setChecked] = useState(true);
  const [clear, setClear] = useState(false);
  const [fx, setFx] = useState("");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 打開時重來。
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChoiceKey("rename");
      setText("");
      setChecked(true);
      setClear(false);
      setFx("");
      setFind("");
      setReplace("");
      setError(null);
    }
  }

  const choice = choices.find((c) => c.key === choiceKey) ?? choices[0];
  const column = choice.kind === "column" ? choice.column : null;
  const canClear = column !== null && column.type !== "CHECKBOX";

  function changeChoice(key: string) {
    setChoiceKey(key);
    setText("");
    setClear(false);
    setError(null);
  }

  function build(): BulkEditField | string {
    if (choice.kind === "rename") {
      if (find === "") return "請輸入要尋找的字樣";
      return { kind: "rename", find, replace };
    }
    if (choice.kind === "qty" || choice.kind === "unitPrice") {
      if (text.trim() === "") return "請輸入數字";
      const value = Number(text.replace(/,/g, ""));
      if (!Number.isFinite(value)) return "請輸入數字";
      return { kind: choice.kind, value };
    }
    if (choice.kind === "currency") {
      const fxRate = fx.trim() === "" ? null : Number(fx);
      if (fxRate !== null && !Number.isFinite(fxRate)) return "匯率請輸入數字";
      return { kind: "currency", currency: text, fxRate };
    }
    const col = choice.column;
    if (col.id === "vendor" || col.id === "note") return { kind: col.id, value: clear ? "" : text };
    if (col.id === "delivery") {
      if (!clear && text.trim() === "") return "請輸入週數(或勾選清空)";
      return { kind: "deliveryDate", value: clear ? null : text };
    }
    if (col.type === "CHECKBOX") return { kind: "custom", columnId: col.id, value: checked };
    if (!clear && text.trim() === "") return "請輸入要設成的值(或勾選清空)";
    return { kind: "custom", columnId: col.id, value: clear ? null : text };
  }

  async function apply() {
    if (busy) return;
    const field = build();
    if (typeof field === "string") {
      setError(field);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await onApply(field);
      if (message) setError(message);
      else onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  function valueInput() {
    if (choice.kind === "rename") {
      return (
        <div className="space-y-2">
          <label className="block text-xs text-neutral-500 dark:text-neutral-400">
            尋找(照字面比對,區分大小寫)
            <input data-bom-bulk-find value={find} onChange={(e) => setFind(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400">
            取代為(留空 = 把那段字刪掉)
            <input data-bom-bulk-replace value={replace} onChange={(e) => setReplace(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">只改打勾的列本身;取代之後名稱會變空白的列略過。</p>
        </div>
      );
    }
    if (choice.kind === "currency") {
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <label className="block flex-1 text-xs text-neutral-500 dark:text-neutral-400">
              幣別(三個英文字母)
              <input data-bom-bulk-value value={text} onChange={(e) => setText(e.target.value.toUpperCase())} placeholder="TWD、USD…" maxLength={3} className={`${inputClass} mt-1`} />
            </label>
            <label className="block flex-1 text-xs text-neutral-500 dark:text-neutral-400">
              匯率(外幣才需要)
              <input data-bom-bulk-fx value={fx} onChange={(e) => setFx(e.target.value)} inputMode="decimal" placeholder="留空 = 系統設定裡目前的匯率" className={`${inputClass} mt-1`} />
            </label>
          </div>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">只套用在零件上(有子項目的列,單價是底下加總算出來的)。</p>
        </div>
      );
    }
    if (choice.kind === "unitPrice") {
      return (
        <div className="space-y-2">
          <input data-bom-bulk-value value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" placeholder="單價" className={inputClass} />
          <p className="text-xs text-neutral-400 dark:text-neutral-500">只套用在零件上,幣別維持各列原本的。</p>
        </div>
      );
    }
    if (choice.kind === "qty") {
      return <input data-bom-bulk-value value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" placeholder="數量(大於 0)" className={inputClass} />;
    }
    const col = choice.column;
    const disabled = clear;
    let control: React.ReactNode;
    if (col.id === "delivery") {
      control = <input data-bom-bulk-value value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} inputMode="decimal" placeholder="週數,例如 8" className={inputClass} />;
    } else if (col.type === "DATE") {
      control = (
        <>
          <input data-bom-bulk-value type="date" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} className={inputClass} />
          <DateWeekdayHint value={text} />
        </>
      );
    } else if (col.type === "SELECT") {
      control = (
        <select data-bom-bulk-value value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} className={inputClass}>
          <option value="">選一個…</option>
          {col.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    } else if (col.type === "PERSON") {
      control = (
        <select data-bom-bulk-value value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} className={inputClass}>
          <option value="">選一個人…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      );
    } else if (col.type === "CHECKBOX") {
      control = (
        <select data-bom-bulk-value value={checked ? "1" : "0"} onChange={(e) => setChecked(e.target.value === "1")} className={inputClass}>
          <option value="1">勾選(是)</option>
          <option value="0">不勾(否)</option>
        </select>
      );
    } else {
      control = (
        <input
          data-bom-bulk-value
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          inputMode={col.type === "NUMBER" ? "decimal" : undefined}
          placeholder={col.type === "LINK" ? "https://" : "要設成的內容"}
          className={inputClass}
        />
      );
    }
    return (
      <div className="space-y-2">
        {control}
        {canClear && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
            <input data-bom-bulk-clear type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
            清空這個欄位
          </label>
        )}
      </div>
    );
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`批次編輯(已選 ${count} 列)`} size="lg">
      <div data-bom-bulk-edit className="space-y-3">
        <label className="block text-xs text-neutral-500 dark:text-neutral-400">
          要改的欄位
          <select data-bom-bulk-field value={choiceKey} onChange={(e) => changeChoice(e.target.value)} className={`${inputClass} mt-1`}>
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {valueInput()}
        {error && (
          <p data-bom-bulk-error className="whitespace-pre-line rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            data-bom-bulk-apply
            disabled={busy}
            onClick={() => void apply()}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "套用中..." : `套用到 ${count} 列`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
