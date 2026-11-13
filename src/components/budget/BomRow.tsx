"use client";

import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { cellFieldClass } from "@/components/board/cell-editors/cellFieldClass";
import { formatMoney } from "@/lib/cost";
import type { BomLineDraft } from "@/lib/actions/bom";
import { isCustomColumn, isEmptyCellValue, isMoneyBlock, isStoredCustomColumn, type BomColumnDef } from "@/lib/bomColumns";
import { BomFileCell, type BomFileRef } from "./BomFileCell";
import { withWeekday } from "@/lib/weekdayLabel";

const inputClass = cellFieldClass(false);
const cellPad = "px-1 py-1";

/**
 * 自訂欄位的最小寬度(依類型):表格是 w-full 自動分配,欄位一多,下拉選單與連結會被擠到只剩一兩個字。
 * 內建欄位維持原本的寬度;太寬的表格由外層的橫向捲動接住。
 */
const CUSTOM_MIN_WIDTH: Record<BomColumnDef["type"], string> = {
  TEXT: "min-w-[8rem]",
  NUMBER: "min-w-[6rem]",
  DATE: "min-w-[9rem]",
  SELECT: "min-w-[9rem]",
  PERSON: "min-w-[9rem]",
  CHECKBOX: "min-w-[4rem]",
  LINK: "min-w-[11rem]",
  FILE: "min-w-[11rem]",
};

/** 金額那一塊各欄的最小寬度:欄位一多,數量、單價、幣別不能被擠到只剩一個字,「(子項目加總)」也不能折成好幾行。 */
export const MONEY_MIN_WIDTH = {
  qty: "min-w-[4rem]",
  price: "min-w-[6.5rem]",
  currency: "min-w-[4.5rem]",
  fx: "min-w-[5rem]",
  subtotal: "min-w-[6.5rem]",
} as const;

/** 名稱欄與內建欄位的最小寬度:自訂欄位一多,它們不能被擠到只剩一兩個字。 */
export const NAME_MIN_WIDTH = "min-w-[11rem]";
/** 名稱後面固定有的「BOM LEVEL」欄:數字 + 升階 / 降階兩個按鈕。 */
export const LEVEL_MIN_WIDTH = "min-w-[6.5rem]";
const BUILT_IN_MIN_WIDTH: Record<string, string> = {
  vendor: "min-w-[6.5rem]",
  partNumber: "min-w-[6.5rem]",
  note: "min-w-[6.5rem]",
  delivery: "min-w-[8.5rem]",
};

/** 這個欄位的格子(與表頭)要加的最小寬度 class。 */
export const columnMinWidth = (column: BomColumnDef): string =>
  isCustomColumn(column) ? CUSTOM_MIN_WIDTH[column.type] : (BUILT_IN_MIN_WIDTH[column.id] ?? "");

/** 一格的狀態:文字類欄位是字串(輸入框的內容),勾選是 true / false。 */
type CellState = string | boolean;

type FieldState = {
  name: string;
  qty: string;
  unitPrice: string;
  currency: string;
  fxRate: string;
  /** 畫出來的欄位(內建的與自訂的),key 是欄位代號。 */
  fields: Record<string, CellState>;
};

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
  /** 自訂欄位的值(欄位代號 → 值)。空白列放的是各欄位的預設值。 */
  extra?: Record<string, unknown>;
  /** 「檔案附件」欄位上的檔案(欄位代號 → 檔案清單)。 */
  files?: Record<string, BomFileRef[]>;
};

/** 內建欄位的值在 BomRowInitial 的哪個欄位;自訂欄位的值在 extra 裡。 */
export function initialValueOf(initial: BomRowInitial, column: BomColumnDef): unknown {
  switch (column.id) {
    case "vendor":
      return initial.vendor;
    case "partNumber":
      return initial.partNumber;
    case "delivery":
      return initial.deliveryDate;
    case "note":
      return initial.note;
    default:
      return initial.extra?.[column.id];
  }
}

function initialFields(columns: BomColumnDef[], initial: BomRowInitial): Record<string, CellState> {
  const out: Record<string, CellState> = {};
  for (const column of columns) {
    if (isMoneyBlock(column) || column.type === "FILE") continue; // 檔案附件的檔案不在格子的值裡
    const raw = initialValueOf(initial, column);
    out[column.id] = column.type === "CHECKBOX" ? raw === true : raw === null || raw === undefined ? "" : String(raw);
  }
  return out;
}

function toDraft(v: FieldState, columns: BomColumnDef[], initial: BomRowInitial): BomLineDraft {
  const currency = v.currency.trim().toUpperCase() || "TWD";
  const text = (id: string, fallback: string) => (id in v.fields ? String(v.fields[id]).trim() : fallback);
  // 隱藏的內建欄位不在畫面上,維持原本的值;隱藏的自訂欄位不送(伺服器那邊沒送的欄位維持原值、新增的列帶預設值)。
  const extra: Record<string, unknown> = {};
  for (const column of columns) if (isStoredCustomColumn(column)) extra[column.id] = v.fields[column.id];
  return {
    id: initial.id,
    parentId: initial.parentId,
    name: v.name.trim(),
    vendor: text("vendor", initial.vendor),
    partNumber: text("partNumber", initial.partNumber),
    qty: Number(v.qty),
    unitPrice: Number(v.unitPrice),
    currency,
    fxRate: currency === "TWD" ? 1 : Number(v.fxRate),
    deliveryDate: ("delivery" in v.fields ? String(v.fields.delivery) : (initial.deliveryDate ?? "")) || null,
    note: text("note", initial.note),
    extra,
  };
}

/**
 * 一列 BOM,像 Excel 一樣直接在欄位裡打資訊——沒有另外的新增/編輯彈窗。
 *
 * 整列共用一個「離開這一列才送出」的規則:欄位之間用 Tab/點擊互相切換不會
 * 送出(在同一個 &lt;tr&gt; 裡的 blur 不算數),焦點真正離開這一列(或按 Enter)
 * 才呼叫 onCommit。空白列在名稱還是空的時候完全不送——不然每個欄位都會先
 * 建出一筆只有那個欄位有值的半成品。
 *
 * 送出成功後,既有列什麼都不用做(畫面本來就顯示剛送出的值);空白列會把
 * 自己清空(回到各欄位的預設值),準備讓使用者接著打下一筆——幣別與匯率沿用剛送出的那一筆(一張表常常整份是同一個幣別,
 * 不用每列重打),按 Enter 送出的話游標回到名稱欄,可以一直打下去。
 *
 * 要畫哪些欄位、什麼順序、什麼類型,由 columns 決定(看板的 BOM 欄位設定,見 lib/bomColumns.ts);
 * 金額欄位(數量、單價、幣別、小計)是其中固定的一塊。
 */
export function BomRow({
  depth,
  initial,
  disablePrice,
  extendedTwd,
  leading,
  actions,
  levelCell,
  selectColumn,
  selectCell,
  canEdit,
  columns,
  showFx,
  users,
  vendorListId,
  onCommit,
  onUploadFile,
  onDeleteFile,
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
  /** 「BOM LEVEL」欄的內容(可以改階層的數字與按鈕)。空白列還沒存,只畫它會在的那一層。 */
  levelCell?: React.ReactNode;
  /** 最前面有勾選欄(能編輯的人才有);空白列還沒存,勾選框留白。 */
  selectColumn?: boolean;
  selectCell?: React.ReactNode;
  canEdit: boolean;
  /** 要畫出來的欄位,照顯示順序。 */
  columns: BomColumnDef[];
  /** 匯率要不要單獨一欄(收起來的時候,外幣的匯率放在幣別格裡)。 */
  showFx: boolean;
  /** 「人員」欄位的下拉選單。 */
  users: { id: string; name: string }[];
  /** 廠商欄的建議清單(datalist 的 id)。 */
  vendorListId?: string;
  onCommit: (draft: BomLineDraft) => Promise<boolean>;
  /** 檔案附件欄位:上傳 / 刪除一個檔案。沒給(唯讀、空白列)就不能傳。 */
  onUploadFile?: (lineId: string, columnId: string, file: File) => Promise<boolean>;
  onDeleteFile?: (file: BomFileRef) => Promise<void>;
}) {
  const blank: FieldState = {
    name: initial.name,
    qty: String(initial.qty),
    unitPrice: String(initial.unitPrice),
    currency: initial.currency,
    fxRate: String(initial.fxRate),
    fields: initialFields(columns, initial),
  };
  const [name, setName] = useState(blank.name);
  const [qty, setQty] = useState(blank.qty);
  const [unitPrice, setUnitPrice] = useState(blank.unitPrice);
  const [currency, setCurrency] = useState(blank.currency);
  const [fxRate, setFxRate] = useState(blank.fxRate);
  const [fields, setFields] = useState(blank.fields);
  const lastCommitted = useRef(blank);
  const submitting = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  /** 按 Enter 送出的:送出之後游標回到名稱欄,可以直接打下一列。 */
  const refocusName = useRef(false);
  const isNew = !initial.id;

  const setField = (id: string, value: CellState) => setFields((cur) => ({ ...cur, [id]: value }));
  /** 已存的列的資料格帶這兩個屬性:框選、複製、貼上更新靠它們找格子(空白列沒有)。 */
  const cellAttrs = (key: string): Record<string, string> => (initial.id ? { "data-bom-cell-row": initial.id, "data-bom-cell-col": key } : {});

  async function commitIfNeeded() {
    if (submitting.current) return;
    const current: FieldState = { name, qty, unitPrice, currency, fxRate, fields };
    if (isNew && current.name.trim() === "") return; // 名稱還是空的,先不算數。
    if (!isNew && JSON.stringify(current) === JSON.stringify(lastCommitted.current)) return;

    submitting.current = true;
    const ok = await onCommit(toDraft(current, columns, initial));
    submitting.current = false;
    if (!ok) return;

    lastCommitted.current = current;
    if (isNew) {
      setName(blank.name);
      setQty(blank.qty);
      setUnitPrice(blank.unitPrice);
      // 幣別與匯率沿用剛送出的那一筆。
      setCurrency(current.currency || blank.currency);
      setFxRate(current.fxRate || blank.fxRate);
      setFields(initialFields(columns, initial));
      if (refocusName.current) nameRef.current?.focus();
    }
    refocusName.current = false;
  }

  function handleRowBlur(e: React.FocusEvent<HTMLTableRowElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    void commitIfNeeded();
  }

  function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      refocusName.current = isNew;
      e.currentTarget.blur();
    }
  }

  const twd = currency.trim().toUpperCase() === "TWD";
  // 匯率欄收起來的時候,外幣的匯率直接放在幣別格裡,不然沒地方填。
  const fxInline = !showFx && !twd;

  /** 必填卻沒填的欄位(空白列還沒開始填,不提醒)。 */
  const filesOf = (column: BomColumnDef): BomFileRef[] => initial.files?.[column.id] ?? [];
  const missing = new Set(
    isNew
      ? []
      : columns
          .filter((c) => !isMoneyBlock(c) && c.required && isEmptyCellValue(c, c.type === "FILE" ? (filesOf(c).length > 0 ? true : null) : fields[c.id]))
          .map((c) => c.id)
  );

  function renderField(column: BomColumnDef) {
    const value = fields[column.id];
    const flag = missing.has(column.id) ? " ring-1 ring-amber-400 bg-amber-50 dark:bg-amber-950/30" : "";
    const common = { disabled: !canEdit, "aria-label": column.name, "data-bom-field": column.id } as const;
    switch (column.type) {
      case "FILE":
        return (
          <BomFileCell
            columnId={column.id}
            columnName={column.name}
            files={filesOf(column)}
            canEdit={canEdit}
            saved={!isNew}
            flagged={missing.has(column.id)}
            onUpload={(file) => (onUploadFile && initial.id ? onUploadFile(initial.id, column.id, file) : Promise.resolve(false))}
            onDelete={(file) => onDeleteFile?.(file) ?? Promise.resolve()}
          />
        );
      case "NUMBER":
        return (
          <input
            {...common}
            value={String(value ?? "")}
            onChange={(e) => setField(column.id, e.target.value)}
            onKeyDown={blurOnEnter}
            inputMode="decimal"
            placeholder={column.id === "delivery" ? "週" : undefined}
            className={`${inputClass} text-right${flag}`}
          />
        );
      case "DATE":
        return (
          <input
            {...common}
            type="date"
            value={String(value ?? "")}
            title={withWeekday(String(value ?? ""))}
            onChange={(e) => setField(column.id, e.target.value)}
            className={`${inputClass}${flag}`}
          />
        );
      case "SELECT": {
        const current = String(value ?? "");
        // 值已經不在選項裡(選項後來被改掉):還是列出來,不然看起來像是空的。
        const options = current && !column.options.includes(current) ? [...column.options, current] : column.options;
        return (
          <select {...common} value={current} onChange={(e) => setField(column.id, e.target.value)} className={`${inputClass}${flag}`}>
            <option value=""></option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      }
      case "PERSON": {
        const current = String(value ?? "");
        const known = users.some((u) => u.id === current);
        return (
          <select {...common} value={current} onChange={(e) => setField(column.id, e.target.value)} className={`${inputClass}${flag}`}>
            <option value=""></option>
            {current && !known && <option value={current}>(已刪除的使用者)</option>}
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        );
      }
      case "CHECKBOX":
        return (
          <div className={`flex justify-center py-1${flag ? " rounded ring-1 ring-amber-400" : ""}`}>
            <input {...common} type="checkbox" checked={value === true} onChange={(e) => setField(column.id, e.target.checked)} />
          </div>
        );
      case "LINK": {
        const text = String(value ?? "");
        return (
          <div className="flex items-center gap-1">
            <input
              {...common}
              value={text}
              onChange={(e) => setField(column.id, e.target.value)}
              onKeyDown={blurOnEnter}
              placeholder="https://"
              className={`${inputClass}${flag}`}
            />
            {/^https?:\/\//i.test(text) && (
              <a href={text} target="_blank" rel="noopener noreferrer" title="開啟連結" className="shrink-0 text-blue-600 hover:text-blue-800 dark:text-blue-400">
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        );
      }
      default:
        return (
          <input
            {...common}
            value={String(value ?? "")}
            onChange={(e) => setField(column.id, e.target.value)}
            onKeyDown={blurOnEnter}
            list={column.id === "vendor" ? vendorListId : undefined}
            className={`${inputClass}${flag}`}
          />
        );
    }
  }

  return (
    <tr onBlur={handleRowBlur}>
      {selectColumn && <td className="w-8 px-2 py-1 text-center">{selectCell}</td>}
      <td {...cellAttrs("name")} className={`${cellPad} ${NAME_MIN_WIDTH}`} style={{ paddingLeft: 4 + depth * 20 }}>
        <div className="flex items-center gap-1">
          {leading}
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={blurOnEnter}
            disabled={!canEdit}
            placeholder={isNew ? "+ 新增項目" : ""}
            className={inputClass}
          />
        </div>
      </td>
      <td data-bom-level className={`px-1 py-1 text-center ${LEVEL_MIN_WIDTH}`}>
        {levelCell ?? <span className="text-sm tabular-nums text-neutral-300 dark:text-neutral-600">{depth + 1}</span>}
      </td>
      {columns.map((column) =>
        isMoneyBlock(column) ? (
          <MoneyCells
            key={column.id}
            canEdit={canEdit}
            disablePrice={disablePrice}
            twd={twd}
            showFx={showFx}
            fxInline={fxInline}
            qty={qty}
            setQty={setQty}
            unitPrice={unitPrice}
            setUnitPrice={setUnitPrice}
            currency={currency}
            setCurrency={setCurrency}
            fxRate={fxRate}
            setFxRate={setFxRate}
            extendedTwd={extendedTwd}
            blurOnEnter={blurOnEnter}
            cellAttrs={cellAttrs}
          />
        ) : (
          <td key={column.id} {...(column.type !== "FILE" ? cellAttrs(column.id) : {})} className={`${cellPad} ${columnMinWidth(column)}`}>
            {renderField(column)}
          </td>
        )
      )}
      {canEdit && (
        <td className="px-2 py-1">
          <div className="flex items-center justify-end gap-1">{actions}</div>
        </td>
      )}
    </tr>
  );
}

/** 金額欄位那一塊:數量、單價、幣別、(匯率)、小計。 */
function MoneyCells({
  canEdit,
  disablePrice,
  twd,
  showFx,
  fxInline,
  qty,
  setQty,
  unitPrice,
  setUnitPrice,
  currency,
  setCurrency,
  fxRate,
  setFxRate,
  extendedTwd,
  blurOnEnter,
  cellAttrs,
}: {
  canEdit: boolean;
  disablePrice: boolean;
  twd: boolean;
  showFx: boolean;
  fxInline: boolean;
  qty: string;
  setQty: (v: string) => void;
  unitPrice: string;
  setUnitPrice: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  fxRate: string;
  setFxRate: (v: string) => void;
  extendedTwd: number | null;
  blurOnEnter: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  cellAttrs: (key: string) => Record<string, string>;
}) {
  return (
    <>
      <td {...cellAttrs("qty")} className={`${cellPad} ${MONEY_MIN_WIDTH.qty}`}>
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={blurOnEnter}
          disabled={!canEdit}
          inputMode="decimal"
          className={`${inputClass} text-right`}
        />
      </td>
      <td {...cellAttrs("unitPrice")} className={`${cellPad} ${MONEY_MIN_WIDTH.price}`}>
        {disablePrice ? (
          <span className="block whitespace-nowrap px-2 py-1 text-right text-xs text-neutral-400 dark:text-neutral-500">(子項目加總)</span>
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
      <td {...cellAttrs("currency")} className={`${cellPad} ${MONEY_MIN_WIDTH.currency}`}>
        {disablePrice ? (
          <span className="block px-2 py-1 text-center text-xs text-neutral-300 dark:text-neutral-600">—</span>
        ) : (
          <>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              onKeyDown={blurOnEnter}
              disabled={!canEdit}
              maxLength={3}
              className={`${inputClass} text-center uppercase`}
            />
            {fxInline && (
              <input
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                onKeyDown={blurOnEnter}
                disabled={!canEdit}
                inputMode="decimal"
                placeholder="匯率"
                title="外幣對台幣的匯率"
                aria-label="匯率"
                className={`${inputClass} mt-1 text-right`}
              />
            )}
          </>
        )}
      </td>
      {showFx && (
        <td {...cellAttrs("fxRate")} className={`${cellPad} ${MONEY_MIN_WIDTH.fx}`}>
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
      )}
      <td className={`px-3 py-1.5 text-right tabular-nums font-medium text-neutral-800 dark:text-neutral-100 ${MONEY_MIN_WIDTH.subtotal}`}>
        {extendedTwd !== null ? formatMoney(extendedTwd) : ""}
      </td>
    </>
  );
}
