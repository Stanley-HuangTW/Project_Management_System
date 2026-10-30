"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { HScrollPane } from "@/components/ui/HScrollPane";
import { formatMoney } from "@/lib/cost";
import {
  deleteNreLine,
  exportNreWorkbook,
  getNreSheet,
  importNreWorkbook,
  saveNreLine,
  type NreLineRow,
  type NrePhase,
  type NreSheet,
} from "@/lib/actions/nre";
import {
  NRE_CATEGORIES,
  NRE_CATEGORY_GUIDE,
  NRE_LABELS,
  WHOLE_PROJECT_LABEL,
  parseNumberField,
  resolveNreAmount,
  summarizeNre,
  type NreCategoryKey,
  type NreLineInput,
} from "@/lib/nre";
import { knownErrorMessage } from "@/lib/userError";

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
  /** 時間範圍(只有委託開發),"YYYY-MM-DD" 或空白。 */
  startDate: string;
  endDate: string;
  /** 範圍(只有委託開發):階段的 id;空字串 = 涵蓋整個專案。 */
  scope: string;
};

/** 畫面所在的階段,以及這個看板所有的階段(委託開發的範圍下拉要用)。 */
type Context = { phaseId: string; phases: NrePhase[] };

/** 新的一列:委託開發的範圍預設是現在這個階段。 */
const emptyFields = (phaseId: string): Fields => ({
  description: "",
  basis: "",
  vendor: "",
  quantity: "",
  unitPrice: "",
  amount: "",
  note: "",
  startDate: "",
  endDate: "",
  scope: phaseId,
});

function toFields(line: NreLineRow): Fields {
  return {
    description: line.description,
    basis: line.basis,
    vendor: line.vendor,
    quantity: line.quantity === null ? "" : String(line.quantity),
    unitPrice: line.unitPrice === null ? "" : String(line.unitPrice),
    amount: String(line.amount),
    note: line.note,
    startDate: line.startDate ?? "",
    endDate: line.endDate ?? "",
    scope: line.phaseId ?? "",
  };
}

/** 輸入框的文字轉成要存的內容;數字欄位不是數字就回錯誤訊息。 */
function toInput(category: NreCategoryKey, f: Fields, phaseId: string): NreLineInput | string {
  const quantity = parseNumberField(f.quantity);
  const unitPrice = parseNumberField(f.unitPrice);
  const amount = parseNumberField(f.amount);
  if (Number.isNaN(quantity)) return "數量不是數字";
  if (Number.isNaN(unitPrice)) return "單價不是數字";
  if (Number.isNaN(amount)) return "金額不是數字";
  // 範圍與時間範圍只有委託開發有;別類永遠掛在現在這個階段。
  const commissioned = category === "COMMISSIONED";
  return {
    category,
    phaseId: commissioned ? f.scope || null : phaseId,
    startDate: commissioned ? f.startDate || null : null,
    endDate: commissioned ? f.endDate || null : null,
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
    input.note.trim() === line.note &&
    input.phaseId === line.phaseId &&
    input.startDate === line.startDate &&
    input.endDate === line.endDate
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
  context,
  fields,
  onChange,
  disabled,
}: {
  category: NreCategoryKey;
  context: Context;
  fields: Fields;
  onChange: (next: Fields) => void;
  disabled: boolean;
}) {
  const guide = NRE_CATEGORY_GUIDE[category];
  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...fields, [key]: e.target.value });
  // 委託開發的欄位多,輸入框的最小寬度縮一點,才放得進一個畫面。
  const compact = category === "COMMISSIONED";
  const input = toInput(category, fields, context.phaseId);
  const computed = isComputed(fields) && typeof input !== "string" ? resolveNreAmount(input) : null;
  return (
    <>
      <td className="px-1.5 py-1">
        <input value={fields.description} onChange={set("description")} disabled={disabled} placeholder={guide.descriptionExample} className={`${fieldClass} ${compact ? "min-w-[10rem]" : "min-w-[12rem]"}`} aria-label={guide.descriptionLabel} />
      </td>
      <td className="px-1.5 py-1">
        <input value={fields.basis} onChange={set("basis")} disabled={disabled} placeholder={guide.basisExample} className={`${fieldClass} ${compact ? "min-w-[7rem]" : "min-w-[9rem]"}`} aria-label="估算基礎" />
      </td>
      <td className="px-1.5 py-1">
        <input value={fields.vendor} onChange={set("vendor")} disabled={disabled} placeholder={guide.vendorLabel} className={`${fieldClass} min-w-[7rem]`} aria-label={guide.vendorLabel} />
      </td>
      {category === "COMMISSIONED" && (
        <>
          <td className="px-1.5 py-1">
            <input type="date" value={fields.startDate} onChange={set("startDate")} disabled={disabled} max={fields.endDate || undefined} className={`${fieldClass} w-[7.75rem]`} aria-label="開始日" />
          </td>
          <td className="px-1.5 py-1">
            <input type="date" value={fields.endDate} onChange={set("endDate")} disabled={disabled} min={fields.startDate || undefined} className={`${fieldClass} w-[7.75rem]`} aria-label="結束日" />
          </td>
          <td className="px-1.5 py-1">
            <select value={fields.scope} onChange={(e) => onChange({ ...fields, scope: e.target.value })} disabled={disabled} className={`${fieldClass} min-w-[7rem]`} aria-label="範圍">
              <option value="">{WHOLE_PROJECT_LABEL}</option>
              {context.phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </td>
        </>
      )}
      <td className="px-1.5 py-1">
        <input value={fields.quantity} onChange={set("quantity")} disabled={disabled} inputMode="decimal" placeholder={guide.quantityLabel} className={`${fieldClass} min-w-[4rem] text-right tabular-nums`} aria-label={guide.quantityLabel} />
      </td>
      <td className="px-1.5 py-1">
        <input value={fields.unitPrice} onChange={set("unitPrice")} disabled={disabled} inputMode="numeric" placeholder={guide.unitPriceLabel} className={`${fieldClass} min-w-[5rem] text-right tabular-nums`} aria-label={guide.unitPriceLabel} />
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
        <input value={fields.note} onChange={set("note")} disabled={disabled} placeholder="備註" className={`${fieldClass} ${compact ? "min-w-[6rem]" : "min-w-[8rem]"}`} aria-label="備註" />
      </td>
    </>
  );
}

type SaveResult = { error?: string };

/** 已存在的一列:離開這一列(焦點移到別的地方)才存,在同一列的欄位之間移動不會存。 */
function NreRow({
  category,
  context,
  line,
  canEdit,
  onSave,
  onDelete,
}: {
  category: NreCategoryKey;
  context: Context;
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
    const input = toInput(category, fields, context.phaseId);
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
      <FieldCells category={category} context={context} fields={fields} onChange={setFields} disabled={!canEdit} />
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
  context,
  onAdd,
}: {
  category: NreCategoryKey;
  context: Context;
  onAdd: (input: NreLineInput) => Promise<SaveResult>;
}) {
  const { notify } = useDialogs();
  const [fields, setFields] = useState<Fields>(() => emptyFields(context.phaseId));
  const [busy, setBusy] = useState(false);

  async function add() {
    if (busy) return;
    const input = toInput(category, fields, context.phaseId);
    if (typeof input === "string") {
      await notify(input, { title: "無法加入" });
      return;
    }
    setBusy(true);
    try {
      const result = await onAdd(input);
      if (result.error) await notify(result.error, { title: "無法加入" });
      else setFields(emptyFields(context.phaseId));
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
      <FieldCells category={category} context={context} fields={fields} onChange={setFields} disabled={busy} />
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
  context,
  lines,
  subtotal,
  canEdit,
  onSave,
  onAdd,
  onDelete,
}: {
  category: NreCategoryKey;
  context: Context;
  lines: NreLineRow[];
  subtotal: number;
  canEdit: boolean;
  onSave: (input: NreLineInput & { id: string }) => Promise<SaveResult>;
  onAdd: (input: NreLineInput) => Promise<SaveResult>;
  onDelete: (line: NreLineRow) => void;
}) {
  const guide = NRE_CATEGORY_GUIDE[category];
  const commissioned = category === "COMMISSIONED";
  const columns = commissioned ? 12 : 8;
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
        <table className={`w-full text-xs ${commissioned ? "min-w-[1200px]" : "min-w-[960px]"}`}>
          <thead className="text-neutral-500 dark:text-neutral-400">
            <tr>
              <th className="px-1.5 py-1.5 text-left font-medium">{guide.descriptionLabel}</th>
              <th className="px-1.5 py-1.5 text-left font-medium">估算基礎</th>
              <th className="px-1.5 py-1.5 text-left font-medium">{guide.vendorLabel}</th>
              {commissioned && (
                <>
                  <th className="px-1.5 py-1.5 text-left font-medium">開始日</th>
                  <th className="px-1.5 py-1.5 text-left font-medium">結束日</th>
                  <th className="px-1.5 py-1.5 text-left font-medium">範圍</th>
                </>
              )}
              <th className="px-1.5 py-1.5 text-right font-medium">{guide.quantityLabel}</th>
              <th className="px-1.5 py-1.5 text-right font-medium">{guide.unitPriceLabel}</th>
              <th className="px-1.5 py-1.5 text-right font-medium">金額(元)</th>
              <th className="px-1.5 py-1.5 text-left font-medium">備註</th>
              <th className="px-1.5 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {lines.map((line) => (
              <NreRow key={line.id} category={category} context={context} line={line} canEdit={canEdit} onSave={onSave} onDelete={onDelete} />
            ))}
            {lines.length === 0 && !canEdit && (
              <tr>
                <td colSpan={columns} className="px-3 py-4 text-center text-neutral-400 dark:text-neutral-500">
                  這一類還沒有項目。
                </td>
              </tr>
            )}
            {canEdit && <NreDraftRow category={category} context={context} onAdd={onAdd} />}
          </tbody>
        </table>
      </HScrollPane>
    </section>
  );
}

/**
 * NRE(一次性工程費用)報價單:照各大項逐列填細項說明、估算基礎、外部單位 / 人員、數量(研發人力是工時)、
 * 單價(研發人力是時薪)與金額,自動算各類小計與總計。委託開發另外有委託單位、委託項目、時間範圍,
 * 以及範圍(哪一個階段,或涵蓋整個專案)。
 *
 * 這是估算與報價的依據,不會寫進「階段預算」的核准預算——兩邊各自獨立。
 */
export function NreQuoteSheet({ phaseId }: { phaseId: string }) {
  const { confirm, notify } = useDialogs();
  const [sheet, setSheet] = useState<NreSheet | null | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const { boardId, phases } = sheet;
  const context: Context = { phaseId, phases };

  async function reload() {
    setSheet(await getNreSheet(phaseId));
  }

  async function save(input: NreLineInput & { id?: string }): Promise<SaveResult> {
    try {
      const result = await saveNreLine(boardId, input);
      if (!result.error) {
        await reload();
        // 委託開發選了別的階段:那一列屬於那個階段的報價單,不在這個畫面裡,說一聲免得以為不見了。
        if (input.phaseId !== null && input.phaseId !== phaseId) {
          const name = phases.find((p) => p.id === input.phaseId)?.name ?? "";
          await notify(`「${input.description.trim()}」已存到「${name}」階段的報價單。`, { title: "已儲存" });
        }
      }
      return result;
    } catch (err) {
      return { error: knownErrorMessage(err, "儲存失敗,請重新整理後再試一次。") };
    }
  }

  /** 匯出成 Excel 並下載。 */
  async function download() {
    setExporting(true);
    try {
      const out = await exportNreWorkbook(phaseId);
      if ("error" in out) {
        await notify(out.error, { title: "無法匯出" });
        return;
      }
      const bytes = Uint8Array.from(atob(out.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = out.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      await notify(knownErrorMessage(err, "匯出失敗,請重新整理後再試一次。"), { title: "無法匯出" });
    } finally {
      setExporting(false);
    }
  }

  /**
   * 匯入 Excel:先讀檔、算出會新增與更新哪些(預覽,還沒寫),列給使用者確認,確認了才真的寫入。
   * 只新增與更新,報價單裡 Excel 沒提到的列不會被刪。
   */
  async function upload(file: File) {
    setImporting(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const base64 = btoa(binary);

      const preview = await importNreWorkbook(phaseId, base64, false);
      if (preview.error) {
        await notify([preview.error, ...preview.warnings.slice(0, 8).map((w) => `• ${w}`)].join("\n"), { title: "無法匯入" });
        return;
      }
      const warningLines = (extra = "") =>
        preview.warnings.length === 0
          ? []
          : ["", `有 ${preview.warnings.length} 列讀不進來,那幾列會略過${extra}:`, ...preview.warnings.slice(0, 8).map((w) => `• ${w}`), ...(preview.warnings.length > 8 ? [`……還有 ${preview.warnings.length - 8} 列`] : [])];
      if (preview.created + preview.updated === 0) {
        await notify(
          ["這份 Excel 跟目前的報價單內容一樣,沒有需要匯入的變動。", ...warningLines()].join("\n"),
          { title: "匯入報價單" }
        );
        return;
      }
      const shown = preview.changes.slice(0, 12);
      const message = [
        `要匯入這份 Excel 嗎?`,
        "",
        `• 新增 ${preview.created} 列`,
        `• 更新 ${preview.updated} 列`,
        `• 沒有變動 ${preview.unchanged} 列`,
        ...(preview.untouched > 0 ? [`• 報價單裡有、Excel 沒提到的 ${preview.untouched} 列維持原樣(匯入不會刪列)`] : []),
        "",
        ...shown.map((c) => `• ${c}`),
        ...(preview.changes.length > shown.length ? [`……還有 ${preview.changes.length - shown.length} 筆變動`] : []),
        ...warningLines(),
      ].join("\n");
      if (!(await confirm(message, { title: "匯入報價單", confirmLabel: "匯入" }))) return;

      const result = await importNreWorkbook(phaseId, base64, true);
      if (result.error) {
        await notify(result.error, { title: "無法匯入" });
        return;
      }
      await reload();
    } catch (err) {
      await notify(knownErrorMessage(err, "匯入失敗,請重新整理後再試一次。"), { title: "無法匯入" });
    } finally {
      setImporting(false);
    }
  }

  async function remove(line: NreLineRow) {
    if (!(await confirm(`刪除「${line.description}」(${formatMoney(line.amount)} 元)?`, { title: "刪除這一列", confirmLabel: "刪除", danger: true }))) return;
    try {
      const result = await deleteNreLine(boardId, line.id);
      if (result.error) await notify(result.error, { title: "無法刪除" });
      else await reload();
    } catch (err) {
      await notify(knownErrorMessage(err, "刪除失敗,請重新整理後再試一次。"), { title: "無法刪除" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-xs text-neutral-500 dark:text-neutral-400">
          照 NRE 的各大項逐列填,有數量跟單價就自動相乘,沒有就直接填金額;離開那一列時自動儲存。這是估算與報價的依據,
          <b>不會自己改「階段預算」的核准預算</b>——要把報價帶進去,到「階段預算」的「各類別」按「帶入」。
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void download()}
            disabled={exporting || lines.length === 0}
            title={lines.length === 0 ? "還沒有任何項目" : "把這個階段的報價單匯出成 Excel"}
            className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <Download size={13} /> {exporting ? "匯出中..." : "匯出 Excel"}
          </button>
          {sheet.canEdit && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                title="匯入「匯出 Excel」下載的檔案(改好之後)——只新增與更新,不會刪列"
                className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <Upload size={13} /> {importing ? "匯入中..." : "匯入 Excel"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </>
          )}
        </div>
      </div>

      {!sheet.canEdit && (
        <p className="rounded-md border border-dashed border-neutral-300 p-2 text-xs text-neutral-500 dark:border-neutral-600 dark:text-neutral-400">
          你只能查看。只有管理者、專案建立者與該分組的 Team Leader 可以編輯報價單。
        </p>
      )}

      {NRE_CATEGORIES.map((category) => (
        <NreSection
          key={category}
          category={category}
          context={context}
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
