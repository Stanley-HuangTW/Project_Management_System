"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { formatMoney } from "@/lib/cost";
import {
  getBomContext,
  getBomView,
  upsertBomLine,
  deleteBomLine,
  copyBomLines,
  type BomContext,
  type BomView,
  type BomLineRow,
} from "@/lib/actions/bom";
import { BomLineDialog, type BomLineOption } from "./BomLineDialog";
import type { BomLineDraft } from "@/lib/actions/bom";

/** 這一列自己與它底下所有子孫的 id —— flattenBom 是先序走訪,子孫剛好是
 *  它後面那一段「深度比它深」的連續區間,不用重新爬一次樹。 */
function subtreeIds(lines: BomLineRow[], rootIndex: number): Set<string> {
  const root = lines[rootIndex];
  const ids = new Set([root.id]);
  for (let i = rootIndex + 1; i < lines.length && lines[i].depth > root.depth; i++) {
    ids.add(lines[i].id);
  }
  return ids;
}

/** 編輯既有列時,自己跟自己的子孫都不能選成自己的上層——選了會繞成一圈。 */
function parentOptionsFor(lines: BomLineRow[], editingId?: string): BomLineOption[] {
  const excluded = editingId
    ? subtreeIds(lines, lines.findIndex((l) => l.id === editingId))
    : new Set<string>();
  return lines
    .filter((l) => !excluded.has(l.id))
    .map((l) => ({ id: l.id, name: l.name, depth: l.depth }));
}

/**
 * 樣機 BOM:某個產品、某個階段一份表。列廠商/型號/名稱,可以往下分子集,
 * 最後在頁尾算出一台裝置多少錢。
 *
 * 產品跟階段用同一組下拉,跟樣機計畫共用同一組階段 —— EVT 兩台給 SW 做
 * mock up,料號要對的也是那個 EVT 的 BOM。
 */
export function BomTable({ boardId }: { boardId: string }) {
  const { notify, confirm } = useDialogs();
  const [ctx, setCtx] = useState<BomContext | null>(null);
  const [product, setProduct] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [view, setView] = useState<BomView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ initial?: BomLineDraft; hasChildren: boolean } | null>(null);
  const [copyFrom, setCopyFrom] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getBomContext(boardId);
        if (cancelled) return;
        setCtx(result);
        setProduct((current) => current || result?.products[0] || "");
        setPhaseId((current) => current || result?.phases[0]?.id || "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  // reload 只給 run() 在操作完之後呼叫,不要在 useEffect 裡直接呼叫它——
  // effect 要重讀就直接把抓資料的邏輯寫在 effect 自己裡面(下面那個
  // useEffect),不透過另一個具名函式,才不會被判定成在 effect 裡同步
  // 觸發 setState。
  const reload = useCallback(async () => {
    setView(product && phaseId ? await getBomView(boardId, product, phaseId) : null);
  }, [boardId, product, phaseId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = product && phaseId ? await getBomView(boardId, product, phaseId) : null;
      if (!cancelled) setView(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, product, phaseId]);

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return;
      }
      await reload();
      // 產品/階段的候選清單可能因為這次操作多了一個新名字,一併重讀。
      setCtx(await getBomContext(boardId));
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : failTitle }
      );
    } finally {
      setBusy(false);
    }
  }

  function openAdd(parentId: string | null) {
    setDialog({
      initial: {
        parentId,
        name: "",
        vendor: "",
        partNumber: "",
        qty: 1,
        unitPrice: 0,
        currency: "TWD",
        fxRate: 1,
        note: "",
      },
      hasChildren: false,
    });
  }

  function openEdit(line: BomLineRow) {
    setDialog({
      initial: {
        id: line.id,
        parentId: line.parentId,
        name: line.name,
        vendor: line.vendor,
        partNumber: line.partNumber,
        qty: line.qty,
        unitPrice: line.unitPrice,
        currency: line.currency,
        fxRate: line.fxRate,
        note: line.note,
      },
      hasChildren: line.isAssembly,
    });
  }

  async function submitDialog(draft: BomLineDraft) {
    await run(() => upsertBomLine(boardId, product, phaseId, draft), draft.id ? "無法儲存" : "無法新增");
  }

  async function removeLine(line: BomLineRow) {
    const childCount = subtreeIds(view!.lines, view!.lines.findIndex((l) => l.id === line.id)).size - 1;
    const ok = await confirm(
      childCount > 0
        ? `刪除「${line.name}」?底下 ${childCount} 個子項目會一起刪除。`
        : `刪除「${line.name}」?`,
      { title: "刪除 BOM 項目", confirmLabel: "刪除", danger: true }
    );
    if (ok) await run(() => deleteBomLine(boardId, line.id), "無法刪除");
  }

  async function doCopy() {
    if (!copyFrom) return;
    const ok = await confirm(
      `把「${product}」在「${ctx?.phases.find((p) => p.id === copyFrom)?.name}」的 BOM,複製一份到目前這個階段?`,
      { title: "複製 BOM" }
    );
    if (!ok) return;
    await run(() => copyBomLines(boardId, product, copyFrom, phaseId), "無法複製");
    setCopyFrom("");
  }

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!ctx) return null;

  if (ctx.phases.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-neutral-200 py-10 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
        BOM 的欄位是照階段排的。請先到「人力表」建立 EVT、DVT1 這些階段。
      </p>
    );
  }

  const otherPhasesWithBom = ctx.phases.filter((p) => p.id !== phaseId);

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        某個產品、某個階段要用的料:廠商、型號、名稱,可以往下分子集(電池模組底下再掛零件)。算出來
        的單台價格會自動回寫這個階段的材料預算。
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">產品</span>
          <input
            list="bom-products"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="例如 M3、充電站"
            className="w-40 rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
          />
          <datalist id="bom-products">
            {ctx.products.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">階段</span>
          <select
            value={phaseId}
            onChange={(e) => setPhaseId(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
          >
            {ctx.phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {view && view.lines.length === 0 && otherPhasesWithBom.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
              複製自另一個階段
            </span>
            <div className="flex gap-1">
              <select
                value={copyFrom}
                onChange={(e) => setCopyFrom(e.target.value)}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
              >
                <option value="">選一個階段</option>
                {otherPhasesWithBom.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!copyFrom || busy}
                onClick={doCopy}
                className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                <Copy size={12} /> 複製
              </button>
            </div>
          </label>
        )}
      </div>

      {!product ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">先選一個產品。</p>
      ) : !view ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : (
        <>
          {(view.foreignCurrencies.length > 0 || view.orphanIds.length > 0) && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                {view.foreignCurrencies.length > 0 && (
                  <p>用到外幣:{view.foreignCurrencies.join("、")},已按填的匯率換算成台幣。</p>
                )}
                {view.orphanIds.length > 0 && (
                  <p>有 {view.orphanIds.length} 筆的上層資料異常,沒有算進總價,請重新整理後再試。</p>
                )}
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">名稱</th>
                  <th className="px-3 py-2 text-left font-medium">廠商</th>
                  <th className="px-3 py-2 text-left font-medium">型號/料號</th>
                  <th className="px-3 py-2 text-right font-medium">數量</th>
                  <th className="px-3 py-2 text-right font-medium">單價</th>
                  <th className="px-3 py-2 text-right font-medium">小計(台幣)</th>
                  {view.canEdit && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {view.lines.length === 0 ? (
                  <tr>
                    <td colSpan={view.canEdit ? 7 : 6} className="px-3 py-8 text-center text-neutral-400 dark:text-neutral-500">
                      這個產品在這個階段還沒有 BOM。
                    </td>
                  </tr>
                ) : (
                  view.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-1.5" style={{ paddingLeft: 12 + line.depth * 20 }}>
                        <span className="inline-flex items-center gap-1 text-neutral-800 dark:text-neutral-100">
                          {line.depth > 0 && <ChevronRight size={12} className="shrink-0 text-neutral-300" />}
                          {line.name}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-neutral-600 dark:text-neutral-300">{line.vendor || "—"}</td>
                      <td className="px-3 py-1.5 text-neutral-600 dark:text-neutral-300">{line.partNumber || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                        {line.qty}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                        {line.isAssembly ? (
                          <span className="text-neutral-400 dark:text-neutral-500">(子項目加總)</span>
                        ) : line.currency === "TWD" ? (
                          formatMoney(line.unitPrice)
                        ) : (
                          `${line.currency} ${line.unitPrice.toLocaleString("zh-TW")}`
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-neutral-800 dark:text-neutral-100">
                        {formatMoney(line.extendedTwd)}
                      </td>
                      {view.canEdit && (
                        <td className="px-3 py-1.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              title="在這一項底下新增子項目"
                              onClick={() => openAdd(line.id)}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:text-neutral-500 dark:hover:bg-neutral-800"
                            >
                              <Plus size={13} />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              title="編輯"
                              onClick={() => openEdit(line)}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:text-neutral-500 dark:hover:bg-neutral-800"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              title="刪除"
                              onClick={() => removeLine(line)}
                              className="rounded p-1 text-neutral-300 hover:text-red-600 disabled:opacity-40 dark:text-neutral-600"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="border-t-2 border-neutral-300 dark:border-neutral-600">
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-right font-semibold text-neutral-800 dark:text-neutral-100">
                    單台成本
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
                    {formatMoney(view.unitCostTwd)}
                  </td>
                  {view.canEdit && <td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {view.canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => openAdd(null)}
              className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              <Plus size={13} /> 新增最上層項目
            </button>
          )}
        </>
      )}

      {view && (
        <BomLineDialog
          open={dialog !== null}
          onOpenChange={(next) => !next && setDialog(null)}
          title={dialog?.initial?.id ? "編輯 BOM 項目" : "新增 BOM 項目"}
          initial={dialog?.initial}
          hasChildren={dialog?.hasChildren ?? false}
          parentOptions={parentOptionsFor(view.lines, dialog?.initial?.id)}
          onDelete={
            dialog?.initial?.id
              ? () => removeLine(view.lines.find((l) => l.id === dialog.initial!.id)!)
              : undefined
          }
          onSubmit={submitDialog}
        />
      )}
    </div>
  );
}
