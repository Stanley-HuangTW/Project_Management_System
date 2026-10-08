"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { HScrollPane } from "@/components/ui/HScrollPane";
import { formatMoney } from "@/lib/cost";
import { deleteNreLine, getNreSheet, saveNreLine, type NreLineRow, type NreSheet } from "@/lib/actions/nre";
import {
  NRE_CATEGORIES,
  NRE_CATEGORY_GUIDE,
  NRE_LABELS,
  parseNumberField,
  resolveNreAmount,
  summarizeNre,
  type NreCategoryKey,
  type NreLineInput,
} from "@/lib/nre";

const fieldClass =
  "w-full rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

/** 輸入框裡的文字(都是字串,存的時候才轉數字)。 */
type Fields = {
  description: string;
  basis: string;
  vendor: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  note: string;
};

const EMPTY_FIELDS: Fields = { description: "", basis: "", vendor: "", quantity: "", unitPrice: "", amount: "", note: "" };

function toFields(line: NreLineRow): Fields {
  return {
    description: line.description,
    basis: line.basis,
    vendor: line.vendor,
    quantity: line.quantity === null ? "" : String(line.quantity),
    unitPrice: line.unitPrice === null ? "" : String(line.unitPrice),
    amount: String(line.amount),
    note: line.note,
  };
}

/** 輸入框的文字轉成要存的內容;數字欄位不是數字就回錯誤訊息。 */
function toInput(category: NreCategoryKey, f: Fields): NreLineInput | string {
  const quantity = parseNumberField(f.quantity);
  const unitPrice = parseNumberField(f.unitPrice);
  const amount = parseNumberField(f.amount);
  if (Number.isNaN(quantity)) return "數量不是數字";
  if (Number.isNaN(unitPrice)) return "單價不是數字";
  if (Number.isNaN(amount)) return "金額不是數字";
  return {
    category,
    description: f.description,
    basis: f.basis,
    vendor: f.vendor,
    quantity,
    unitPrice,
    amount: amount ?? 0,
    note: f.note,
  };
}

function sameAsLine(input: NreLineInput, line: NreLineRow): boolean {
  return (
    input.description.trim() === line.description &&
    input.basis.trim() === line.basis &&
    input.vendor.trim() === line.vendor &&
    input.quantity === line.quantity &&
    (input.unitPrice === null ? null : Math.round(input.unitPrice)) === line.unitPrice &&
    resolveNreAmount(input) === line.amount &&
    input.note.trim() === line.note
  );
}

/** 數量跟單價都填了就自動相乘;否則金額自己填。 */
function isComputed(f: Fields): boolean {
  const q = parseNumberField(f.quantity);
  const p = parseNumberField(f.unitPrice);
  return q !== null && p !== null && !Number.isNaN(q) && !Number.isNaN(p) && q > 0 && p >= 0;
}

function FieldCells({
  category,
  fields,
  onChange,
  disabled,
}: {
  category: NreCategoryKey;
  fields: Fields;
  onChange: (next: Fields) => void;
  disabled: boolean;
}) {
  const guide = NRE_CATEGORY_GUIDE[category];
  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...fields, [key]: e.target.value });
  const input = toInput(category, fields);
  const computed = isComputed(fields) && typeof input !== "string" ? resolveNreAmount(input) : null;
  return (
    <>
      <td className="px-1.5 py-1">
        <input value={fields.description} onChange={set("description")} disabled={disabled} placeholder={guide.descriptionExample} className={`${fieldClass} min-w-[12rem]`} aria-label="細項說明" />
      </td>
      <td className="px-1.5 py-1">
        <input value={fields.basis} onChange={set("basis")} disabled={disabled} placeholder={guide.basisExample} className={`${fieldClass} min-w-[9rem]`} aria-label="估算基礎" />
      </td>
      <td className="px-1.5 py-1">
        <input value={fields.vendor} onChange={set("vendor")} disabled={disabled} placeholder={guide.vendorLabel} className={`${fieldClass} min-w-[7rem]`} aria-label={guide.vendorLabel} />
      </td>
      <td className="px-1.5 py-1">
        <input value={fields.quantity} onChange={set("quantity")} disabled={disabled} inputMode="decimal" placeholder={guide.quantityLabel} className={`${fieldClass} w-20 text-right tabular-nums`} aria-label={guide.quantityLabel} />
      </td>
      <td className="px-1.5 py-1">
        <input value={fields.unitPrice} onChange={set("unitPrice")} disabled={disabled} inputMode="numeric" placeholder={guide.unitPriceLabel} className={`${fieldClass} w-24 text-right tabular-nums`} aria-label={guide.unitPriceLabel} />
      </td>
      <td className="px-1.5 py-1 text-right">
        {computed !== null ? (
          <span className="block min-w-[6rem] px-2 py-1 text-xs font-medium tabular-nums text-neutral-800 dark:text-neutral-100" title="數量 × 單價,自動計算">
            {formatMoney(computed)}
          </span>
        ) : (
          <input value={fields.amount} onChange={set("amount")} disabled={disabled} inputMode="numeric" placeholder="金額" className={`${fieldClass} min-w-[6rem] text-right tabular-nums`} aria-label="金額" />
        )}
      </td>
      <td className="px-1.5 py-1">
        <input value={fields.note} onChange={set("note")} disabled={disabled} placeholder="備註" className={`${fieldClass} min-w-[8rem]`} aria-label="備註" />
      </td>
    </>
  );
}

type SaveResult = { error?: string };

/** 已存在的一列:離開這一列(焦點移到別的地方)才存,在同一列的欄位之間移動不會存。 */
function NreRow({
  category,
  line,
  canEdit,
  onSave,
  onDelete,
}: {
  category: NreCategoryKey;
  line: NreLineRow;
  canEdit: boolean;
  onSave: (input: NreLineInput & { id: string }) => Promise<SaveResult>;
  onDelete: (line: NreLineRow) => void;
}) {
  const { notify } = useDialogs();
  const [fields, setFields] = useState<Fields>(() => toFields(line));
  // 伺服器那邊的內容變了(重新讀取)就跟著換,沒變就保留正在打的字。
  const [seen, setSeen] = useState(line);
  if (line !== seen) {
    setSeen(line);
    setFields(toFields(line));
  }

  async function commit() {
    if (!canEdit) return;
    const input = toInput(category, fields);
    if (typeof input === "string") {
      await notify(input, { title: "無法儲存" });
      setFields(toFields(line));
      return;
    }
    if (sameAsLine(input, line)) return;
    const result = await onSave({ ...input, id: line.id });
    if (result.error) {
      await notify(result.error, { title: "無法儲存" });
      setFields(toFields(line));
    }
  }

  return (
    <tr
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void commit();
      }}
    >
      <FieldCells category={category} fields={fields} onChange={setFields} disabled={!canEdit} />
      <td className="px-1.5 py-1 text-right">
        {canEdit && (
          <button
            type="button"
            onClick={() => onDelete(line)}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800"
            aria-label={`刪除「${line.description}」`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </td>
    </tr>
  );
}

/** 最下面那一列空白:填好按「加入」(或在細項說明按 Enter)才新增。 */
function NreDraftRow({
  category,
  onAdd,
}: {
  category: NreCategoryKey;
  onAdd: (input: NreLineInput) => Promise<SaveResult>;
}) {
  const { notify } = useDialogs();
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (busy) return;
    const input = toInput(category, fields);
    if (typeof input === "string") {
      await notify(input, { title: "無法加入" });
      return;
    }
    setBusy(true);
    try {
      const result = await onAdd(input);
      if (result.error) await notify(result.error, { title: "無法加入" });
      else setFields(EMPTY_FIELDS);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr
      className="bg-neutral-50/60 dark:bg-neutral-800/30"
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          void add();
        }
      }}
    >
      <FieldCells category={category} fields={fields} onChange={setFields} disabled={busy} />
      <td className="px-1.5 py-1 text-right">
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || fields.description.trim() === ""}
          className="flex items-center gap-0.5 whitespace-nowrap rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          <Plus size={12} /> 加入
        </button>
      </td>
    </tr>
  );
}

function NreSection({
  category,
  lines,
  subtotal,
  canEdit,
  onSave,
  onAdd,
  onDelete,
}: {
  category: NreCategoryKey;
  lines: NreLineRow[];
  subtotal: number;
  canEdit: boolean;
  onSave: (input: NreLineInput & { id: string }) => Promise<SaveResult>;
  onAdd: (input: NreLineInput) => Promise<SaveResult>;
  onDelete: (line: NreLineRow) => void;
}) {
  const guide = NRE_CATEGORY_GUIDE[category];
  return (
    <section className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <div>
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{NRE_LABELS[category]}</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{guide.hint}</p>
        </div>
        <p className="text-sm tabular-nums text-neutral-600 dark:text-neutral-300">
          小計 <b className="text-neutral-900 dark:text-neutral-100">{formatMoney(subtotal)}</b> 元
        </p>
      </header>
      <HScrollPane>
        <table className="w-full min-w-[960px] text-xs">
          <thead className="text-neutral-500 dark:text-neutral-400">
            <tr>
              <th className="px-1.5 py-1.5 text-left font-medium">細項說明</th>
              <th className="px-1.5 py-1.5 text-left font-medium">估算基礎</th>
              <th className="px-1.5 py-1.5 text-left font-medium">{guide.vendorLabel}</th>
              <th className="px-1.5 py-1.5 text-right font-medium">{guide.quantityLabel}</th>
              <th className="px-1.5 py-1.5 text-right font-medium">{guide.unitPriceLabel}</th>
              <th className="px-1.5 py-1.5 text-right font-medium">金額(元)</th>
              <th className="px-1.5 py-1.5 text-left font-medium">備註</th>
              <th className="px-1.5 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {lines.map((line) => (
              <NreRow key={line.id} category={category} line={line} canEdit={canEdit} onSave={onSave} onDelete={onDelete} />
            ))}
            {lines.length === 0 && !canEdit && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-neutral-400 dark:text-neutral-500">
                  這一類還沒有項目。
                </td>
              </tr>
            )}
            {canEdit && <NreDraftRow category={category} onAdd={onAdd} />}
          </tbody>
        </table>
      </HScrollPane>
    </section>
  );
}

/**
 * NRE(一次性工程費用)報價單:照四大項逐列填細項說明、估算基礎、外部單位 / 人員、數量(研發人力是工時)、
 * 單價(研發人力是時薪)與金額,自動算各類小計與總計。
 *
 * 這是估算與報價的依據,不會寫進「階段預算」的核准預算——兩邊各自獨立。
 */
export function NreQuoteSheet({ phaseId }: { phaseId: string }) {
  const { confirm, notify } = useDialogs();
  const [sheet, setSheet] = useState<NreSheet | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getNreSheet(phaseId);
      if (!cancelled) setSheet(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [phaseId]);

  const lines = useMemo(() => sheet?.lines ?? [], [sheet]);
  const summary = useMemo(() => summarizeNre(lines), [lines]);

  if (sheet === undefined) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (sheet === null) return <p className="text-sm text-neutral-400 dark:text-neutral-500">找不到這個階段。</p>;

  async function reload() {
    setSheet(await getNreSheet(phaseId));
  }

  async function save(input: NreLineInput & { id?: string }): Promise<SaveResult> {
    try {
      const result = await saveNreLine(phaseId, input);
      if (!result.error) await reload();
      return result;
    } catch {
      return { error: "儲存失敗,請重新整理後再試一次。" };
    }
  }

  async function remove(line: NreLineRow) {
    if (!(await confirm(`刪除「${line.description}」(${formatMoney(line.amount)} 元)?`, { title: "刪除這一列", confirmLabel: "刪除", danger: true }))) return;
    try {
      const result = await deleteNreLine(phaseId, line.id);
      if (result.error) await notify(result.error, { title: "無法刪除" });
      else await reload();
    } catch {
      await notify("刪除失敗,請重新整理後再試一次。", { title: "無法刪除" });
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        照 NRE 的四大項逐列填,有數量跟單價就自動相乘,沒有就直接填金額;離開那一列時自動儲存。這是估算與報價的依據,
        <b>不會寫進「階段預算」的核准預算</b>。
      </p>

      {!sheet.canEdit && (
        <p className="rounded-md border border-dashed border-neutral-300 p-2 text-xs text-neutral-500 dark:border-neutral-600 dark:text-neutral-400">
          你只能查看。只有管理者、專案建立者與該分組的 Team Leader 可以編輯報價單。
        </p>
      )}

      {NRE_CATEGORIES.map((category) => (
        <NreSection
          key={category}
          category={category}
          lines={lines.filter((l) => l.category === category)}
          subtotal={summary.byCategory[category].total}
          canEdit={sheet.canEdit}
          onSave={save}
          onAdd={save}
          onDelete={remove}
        />
      ))}

      <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">NRE 總計(一次性費用)</h3>
          <p className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
            {formatMoney(summary.total)} <span className="text-xs font-normal text-neutral-500">元</span>
          </p>
        </div>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {NRE_CATEGORIES.map((category) => {
            const { total } = summary.byCategory[category];
            const share = summary.total > 0 ? Math.round((total / summary.total) * 100) : 0;
            return (
              <li key={category} className="tabular-nums">
                {NRE_LABELS[category]} {formatMoney(total)}
                {summary.total > 0 && `(${share}%)`}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
