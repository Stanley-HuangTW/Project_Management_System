"use client";

import { useRef, useState } from "react";
import { cellFieldClass } from "@/components/board/cell-editors/cellFieldClass";
import { formatMoney } from "@/lib/cost";
import type { BomLineDraft } from "@/lib/actions/bom";

const inputClass = cellFieldClass(false);
const cellPad = "px-1 py-1";

type FieldState = {
  name: string;
  vendor: string;
  partNumber: string;
  qty: string;
  unitPrice: string;
  currency: string;
  fxRate: string;
  deliveryDate: string;
  note: string;
};

function toDraft(v: FieldState, parentId: string | null, id?: string): BomLineDraft {
  const currency = v.currency.trim().toUpperCase() || "TWD";
  return {
    id,
    parentId,
    name: v.name.trim(),
    vendor: v.vendor.trim(),
    partNumber: v.partNumber.trim(),
    qty: Number(v.qty),
    unitPrice: Number(v.unitPrice),
    currency,
    fxRate: currency === "TWD" ? 1 : Number(v.fxRate),
    deliveryDate: v.deliveryDate || null,
    note: v.note.trim(),
  };
}

export type BomRowInitial = {
  /** 有值 = 既有的一列;沒有 = 還沒建出來的空白列,打了名稱才會新增。 */
  id?: string;
  parentId: string | null;
  name: string;
  vendor: string;
  partNumber: string;
  qty: number;
  unitPrice: number;
  currency: string;
  fxRate: number;
  deliveryDate: string | null;
  note: string;
};

/**
 * 一列 BOM,像 Excel 一樣直接在欄位裡打資訊——沒有另外的新增/編輯彈窗。
 *
 * 整列共用一個「離開這一列才送出」的規則:欄位之間用 Tab/點擊互相切換不會
 * 送出(在同一個 &lt;tr&gt; 裡的 blur 不算數),焦點真正離開這一列(或按 Enter)
 * 才呼叫 onCommit。空白列在名稱還是空的時候完全不送——不然每個欄位都會先
 * 建出一筆只有那個欄位有值的半成品。
 *
 * 送出成功後,既有列什麼都不用做(畫面本來就顯示剛送出的值);空白列會把
 * 自己清空,準備讓使用者接著打下一筆。
 */
export function BomRow({
  depth,
  initial,
  disablePrice,
  extendedTwd,
  leading,
  actions,
  canEdit,
  onCommit,
}: {
  depth: number;
  initial: BomRowInitial;
  /** 有子項目的列,單價是算出來的,不能填。 */
  disablePrice: boolean;
  /** 這一列對上一層的貢獻(台幣)。空白列還沒有東西可以算,傳 null。 */
  extendedTwd: number | null;
  /** 縮排前面的小圖示(展開/收合的箭頭,或純粹佔位的空白)。 */
  leading?: React.ReactNode;
  /** 動作欄(新增子項目、刪除),唯讀時不會有。 */
  actions?: React.ReactNode;
  canEdit: boolean;
  onCommit: (draft: BomLineDraft) => Promise<boolean>;
}) {
  const blank: FieldState = {
    name: initial.name,
    vendor: initial.vendor,
    partNumber: initial.partNumber,
    qty: String(initial.qty),
    unitPrice: String(initial.unitPrice),
    currency: initial.currency,
    fxRate: String(initial.fxRate),
    deliveryDate: initial.deliveryDate ?? "",
    note: initial.note,
  };
  const [name, setName] = useState(blank.name);
  const [vendor, setVendor] = useState(blank.vendor);
  const [partNumber, setPartNumber] = useState(blank.partNumber);
  const [qty, setQty] = useState(blank.qty);
  const [unitPrice, setUnitPrice] = useState(blank.unitPrice);
  const [currency, setCurrency] = useState(blank.currency);
  const [fxRate, setFxRate] = useState(blank.fxRate);
  const [deliveryDate, setDeliveryDate] = useState(blank.deliveryDate);
  const [note, setNote] = useState(blank.note);
  const lastCommitted = useRef(blank);
  const submitting = useRef(false);
  const isNew = !initial.id;

  async function commitIfNeeded() {
    if (submitting.current) return;
    const current: FieldState = { name, vendor, partNumber, qty, unitPrice, currency, fxRate, deliveryDate, note };
    if (isNew && current.name.trim() === "") return; // 名稱還是空的,先不算數。
    if (!isNew && JSON.stringify(current) === JSON.stringify(lastCommitted.current)) return;

    submitting.current = true;
    const ok = await onCommit(toDraft(current, initial.parentId, initial.id));
    submitting.current = false;
    if (!ok) return;

    lastCommitted.current = current;
    if (isNew) {
      setName(blank.name);
      setVendor(blank.vendor);
      setPartNumber(blank.partNumber);
      setQty(blank.qty);
      setUnitPrice(blank.unitPrice);
      setCurrency(blank.currency);
      setFxRate(blank.fxRate);
      setDeliveryDate(blank.deliveryDate);
      setNote(blank.note);
    }
  }

  function handleRowBlur(e: React.FocusEvent<HTMLTableRowElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    void commitIfNeeded();
  }

  function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.currentTarget.blur();
  }

  const twd = currency.trim().toUpperCase() === "TWD";

  return (
    <tr onBlur={handleRowBlur}>
      <td className={cellPad} style={{ paddingLeft: 4 + depth * 20 }}>
        <div className="flex items-center gap-1">
          {leading}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={blurOnEnter}
            disabled={!canEdit}
            placeholder={isNew ? "+ 新增項目" : ""}
            className={inputClass}
          />
        </div>
      </td>
      <td className={cellPad}>
        <input value={vendor} onChange={(e) => setVendor(e.target.value)} onKeyDown={blurOnEnter} disabled={!canEdit} className={inputClass} />
      </td>
      <td className={cellPad}>
        <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} onKeyDown={blurOnEnter} disabled={!canEdit} className={inputClass} />
      </td>
      <td className={cellPad}>
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={blurOnEnter}
          disabled={!canEdit}
          inputMode="decimal"
          className={`${inputClass} text-right`}
        />
      </td>
      <td className={cellPad}>
        {disablePrice ? (
          <span className="block px-2 py-1 text-right text-xs text-neutral-400 dark:text-neutral-500">(子項目加總)</span>
        ) : (
          <input
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            onKeyDown={blurOnEnter}
            disabled={!canEdit}
            inputMode="decimal"
            className={`${inputClass} text-right`}
          />
        )}
      </td>
      <td className={cellPad}>
        {disablePrice ? (
          <span className="block px-2 py-1 text-center text-xs text-neutral-300 dark:text-neutral-600">—</span>
        ) : (
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            onKeyDown={blurOnEnter}
            disabled={!canEdit}
            maxLength={3}
            className={`${inputClass} text-center uppercase`}
          />
        )}
      </td>
      <td className={cellPad}>
        {disablePrice ? (
          <span className="block px-2 py-1 text-center text-xs text-neutral-300 dark:text-neutral-600">—</span>
        ) : (
          <input
            value={fxRate}
            onChange={(e) => setFxRate(e.target.value)}
            onKeyDown={blurOnEnter}
            disabled={!canEdit || twd}
            inputMode="decimal"
            className={`${inputClass} text-right disabled:opacity-50`}
          />
        )}
      </td>
      <td className={cellPad}>
        <input
          type="date"
          value={deliveryDate}
          onChange={(e) => setDeliveryDate(e.target.value)}
          disabled={!canEdit}
          className={inputClass}
        />
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-neutral-800 dark:text-neutral-100">
        {extendedTwd !== null ? formatMoney(extendedTwd) : ""}
      </td>
      <td className={cellPad}>
        <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={blurOnEnter} disabled={!canEdit} className={inputClass} />
      </td>
      {canEdit && (
        <td className="px-2 py-1">
          <div className="flex items-center justify-end gap-1">{actions}</div>
        </td>
      )}
    </tr>
  );
}
