"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Download } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { compareBoms, exportBomDiff, type BomDiffResult } from "@/lib/actions/bomDiff";
import { diffStatusLabel, type BomDiffRow } from "@/lib/bomDiff";
import { actionErrorMessage } from "@/lib/userError";

type Source = { product: string; phaseId: string; count: number };

const KEY_SEP = "\u0001";
const keyOf = (s: { product: string; phaseId: string }) => `${s.phaseId}${KEY_SEP}${s.product}`;
const refOf = (key: string) => {
  const at = key.indexOf(KEY_SEP);
  return { phaseId: key.slice(0, at), product: key.slice(at + 1) };
};

const money = (n: number) => n.toLocaleString("zh-TW", { maximumFractionDigits: 2 });

const STATUS_STYLE: Record<BomDiffRow["status"], string> = {
  added: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300",
  removed: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  changed: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  same: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

const ROW_STYLE: Record<BomDiffRow["status"], string> = {
  added: "bg-green-50/60 dark:bg-green-950/20",
  removed: "bg-red-50/60 dark:bg-red-950/20",
  changed: "bg-amber-50/60 dark:bg-amber-950/20",
  same: "",
};

/** 差額:正的是變貴(紅),負的是變便宜(綠),0 不寫。 */
function Delta({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <span className="text-neutral-400">—</span>;
  return (
    <span className={value > 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}>
      {value > 0 ? "+" : "−"}
      {money(Math.abs(value))}
    </span>
  );
}

/**
 * 比較兩份 BOM(例如 EVT 到 DVT):增減了哪些料、改了什麼、單台成本差多少,可以匯出 Excel。
 * 基準是舊的、對象是新的,差額 = 對象 − 基準。唯讀,不會動到任何 BOM。
 */
export function BomDiffDialog({
  open,
  onOpenChange,
  boardId,
  phases,
  sources,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  phases: { id: string; name: string }[];
  /** 哪些(產品,階段)已經有 BOM,兩邊都從這裡選。 */
  sources: Source[];
  /** 目前表格上選的那份:預設當對象。 */
  current: { product: string; phaseId: string } | null;
}) {
  const phaseIndex = useMemo(() => new Map(phases.map((p, i) => [p.id, i])), [phases]);
  const phaseName = useMemo(() => new Map(phases.map((p) => [p.id, p.name])), [phases]);
  const options = useMemo(
    () =>
      [...sources]
        .sort((a, b) => (phaseIndex.get(a.phaseId) ?? 0) - (phaseIndex.get(b.phaseId) ?? 0) || a.product.localeCompare(b.product))
        .map((s) => ({ key: keyOf(s), label: `${s.product} / ${phaseName.get(s.phaseId) ?? ""}`, ...s })),
    [sources, phaseIndex, phaseName]
  );

  const [baseKey, setBaseKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [loaded, setLoaded] = useState<{ key: string; result: BomDiffResult } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // 打開時重來:表格上目前那份,跟同一個產品相鄰的階段比——前面有 BOM 的階段就當基準(目前這份是對象),
  // 沒有就往後找(目前這份是基準);同一個產品沒有別的階段,就跟任何一份別的 BOM 比。
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const cur = options.find((o) => current && o.key === keyOf(current)) ?? options[options.length - 1];
      const ci = cur ? (phaseIndex.get(cur.phaseId) ?? 0) : 0;
      const sameProduct = options.filter((o) => cur && o.product === cur.product && o.key !== cur.key);
      const earlier = sameProduct.filter((o) => (phaseIndex.get(o.phaseId) ?? 0) < ci).pop();
      const later = sameProduct.find((o) => (phaseIndex.get(o.phaseId) ?? 0) > ci);
      const other = options.find((o) => o.key !== cur?.key);
      const [base, target] = earlier ? [earlier, cur] : later ? [cur, later] : [cur, other];
      setBaseKey(base?.key ?? "");
      setTargetKey(target?.key ?? "");
      setOnlyChanged(true);
      setLoaded(null);
      setExportError(null);
    }
  }

  const pairKey = open && baseKey && targetKey && baseKey !== targetKey ? `${baseKey}|${targetKey}` : null;

  useEffect(() => {
    if (!pairKey) return;
    let cancelled = false;
    (async () => {
      let result: BomDiffResult;
      try {
        const [b, t] = pairKey.split("|");
        result = await compareBoms(boardId, refOf(b), refOf(t));
      } catch (e) {
        result = { error: actionErrorMessage(e, "比較失敗") };
      }
      if (!cancelled) setLoaded({ key: pairKey, result });
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, pairKey]);

  const shown = pairKey && loaded && loaded.key === pairKey ? loaded.result : null;
  const loading = pairKey !== null && shown === null;

  async function download() {
    if (!pairKey || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const out = await exportBomDiff(boardId, refOf(baseKey), refOf(targetKey));
      if ("error" in out) return setExportError(out.error);
      const bytes = Uint8Array.from(atob(out.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = out.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(actionErrorMessage(e, "匯出失敗"));
    } finally {
      setExporting(false);
    }
  }

  const select =
    "w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

  const diff = shown && !("error" in shown) ? shown.diff : null;
  const delta = diff ? Math.round((diff.targetUnitCostTwd - diff.baseUnitCostTwd) * 100) / 100 : 0;
  const percent = diff && diff.baseUnitCostTwd !== 0 ? (delta / diff.baseUnitCostTwd) * 100 : null;
  const rows = diff ? diff.rows.filter((r) => !onlyChanged || r.dirty) : [];
  const noDifference = diff !== null && diff.rows.every((r) => !r.dirty);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="比較兩份 BOM" size="xl">
      <div data-bom-diff-dialog className="space-y-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          看兩份 BOM 之間增減了哪些料、改了什麼。<b>基準</b>是舊的、<b>對象</b>是新的,差額 = 對象 − 基準(正的是變貴)。
          兩份的列沒有固定的對應關係,所以先用<b>型號/料號</b>對,再在對得上的上層底下用<b>名稱</b>對;對不上的就是新增或移除。
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-48 flex-1">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">基準(舊)</span>
            <select data-bom-diff-base value={baseKey} onChange={(e) => setBaseKey(e.target.value)} className={select}>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setBaseKey(targetKey);
              setTargetKey(baseKey);
            }}
            title="基準與對象對調"
            aria-label="基準與對象對調"
            className="mb-0.5 rounded-md border border-neutral-300 p-2 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <ArrowLeftRight size={14} />
          </button>
          <label className="block min-w-48 flex-1">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">對象(新)</span>
            <select data-bom-diff-target value={targetKey} onChange={(e) => setTargetKey(e.target.value)} className={select}>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {baseKey === targetKey && <p className="text-sm text-neutral-500 dark:text-neutral-400">兩邊選了同一份,請選不同的兩份。</p>}
        {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">比較中...</p>}
        {shown && "error" in shown && (
          <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {shown.error}
          </p>
        )}

        {diff && shown && !("error" in shown) && (
          <>
            <div
              data-bom-diff-summary
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-700"
            >
              <div>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">單台成本(台幣)</span>
                <div className="mt-0.5 tabular-nums">
                  {money(diff.baseUnitCostTwd)} → <b>{money(diff.targetUnitCostTwd)}</b>{" "}
                  <span className="ml-1">
                    <Delta value={delta} />
                    {percent !== null && Math.abs(delta) >= 0.005 && (
                      <span className={delta > 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}>
                        ({percent > 0 ? "+" : "−"}
                        {Math.abs(percent).toFixed(1)}%)
                      </span>
                    )}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span data-bom-diff-count="added" className={`rounded-full px-2 py-0.5 ${STATUS_STYLE.added}`}>
                  新增 {diff.counts.added}
                </span>
                <span data-bom-diff-count="removed" className={`rounded-full px-2 py-0.5 ${STATUS_STYLE.removed}`}>
                  移除 {diff.counts.removed}
                </span>
                <span data-bom-diff-count="changed" className={`rounded-full px-2 py-0.5 ${STATUS_STYLE.changed}`}>
                  修改 {diff.counts.changed}
                </span>
                <span data-bom-diff-count="same" className={`rounded-full px-2 py-0.5 ${STATUS_STYLE.same}`}>
                  沒變 {diff.counts.same}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-neutral-500 dark:text-neutral-400">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
                只看有變動的(連同它們的上層)
              </label>
              <button
                type="button"
                data-bom-diff-export
                onClick={() => void download()}
                disabled={exporting}
                className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <Download size={13} /> {exporting ? "匯出中..." : "匯出 Excel"}
              </button>
            </div>
            {exportError && (
              <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                {exportError}
              </p>
            )}

            {noDifference ? (
              <p className="rounded-md border border-neutral-200 p-4 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                這兩份 BOM 沒有差異。
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
                <table className="w-full text-sm">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">狀態</th>
                      <th className="min-w-44 px-3 py-2 text-left font-medium">名稱</th>
                      <th className="min-w-56 px-3 py-2 text-left font-medium">變動內容</th>
                      <th className="px-3 py-2 text-right font-medium">基準小計</th>
                      <th className="px-3 py-2 text-right font-medium">對象小計</th>
                      <th className="px-3 py-2 text-right font-medium">差額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.key}
                        data-bom-diff-row={r.status}
                        className={`border-b border-neutral-100 align-top last:border-0 dark:border-neutral-800 ${ROW_STYLE[r.status]}`}
                      >
                        <td className="px-3 py-1.5">
                          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>{diffStatusLabel(r)}</span>
                        </td>
                        <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + r.depth * 16}px` }}>
                          <div className={r.status === "removed" ? "text-neutral-500 line-through dark:text-neutral-400" : ""}>{r.name}</div>
                          {r.partNumber && <div className="text-xs text-neutral-400 dark:text-neutral-500">{r.partNumber}</div>}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {r.changes.map((c) => (
                            <div key={c.label}>
                              <span className="text-neutral-500 dark:text-neutral-400">{c.label}:</span>{" "}
                              <span className="text-neutral-400 line-through dark:text-neutral-500">{c.before}</span> →{" "}
                              <span className="font-medium">{c.after}</span>
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.beforeTotalTwd === null ? "—" : money(r.beforeTotalTwd)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.afterTotalTwd === null ? "—" : money(r.afterTotalTwd)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          <Delta value={(r.afterTotalTwd ?? 0) - (r.beforeTotalTwd ?? 0)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
