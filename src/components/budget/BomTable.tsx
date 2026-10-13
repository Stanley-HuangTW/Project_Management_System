"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardPaste, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { formatMoney } from "@/lib/cost";
import { PRODUCT_SOURCE_LABELS } from "@/lib/bom";
import {
  addProduct,
  deleteProduct,
  renameProduct,
  getBomContext,
  getBomView,
  getProductUsage,
  upsertBomLine,
  deleteBomLine,
  copyBomLines,
  createBom,
  pasteBomLines,
  type BomContext,
  type BomView,
  type BomLineRow,
  type BomLineDraft,
} from "@/lib/actions/bom";
import { BomRow, type BomColumns } from "./BomRow";
import { BomPasteDialog } from "./BomPasteDialog";
import { NewBomDialog } from "./NewBomDialog";
import { BomExcelButtons } from "./BomExcelButtons";

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

const NEW_ROW_BLANK = {
  name: "",
  vendor: "",
  partNumber: "",
  qty: 1,
  unitPrice: 0,
  currency: "TWD",
  fxRate: 1,
  deliveryDate: null,
  note: "",
};

/**
 * 一個節點自己那一列,展開後是它的子項目,子項目底下(展開的話)接著一列
 * 空白列讓使用者直接打字新增下一個子項目——子集底下永遠有這一列在等,不
 * 用另外按按鈕。還沒有子項目的列,按旁邊的「+」才會冒出這一列,免得每個
 * 零件底下都掛一列沒人會用到的空白子項目輸入框。
 */
function BomNodeRows({
  node,
  canEdit,
  cols,
  collapsedIds,
  childEntryIds,
  toggleCollapse,
  revealChildEntry,
  onCommit,
  onDelete,
}: {
  node: BomLineRow;
  canEdit: boolean;
  cols: BomColumns;
  collapsedIds: Set<string>;
  childEntryIds: Set<string>;
  toggleCollapse: (id: string) => void;
  revealChildEntry: (id: string) => void;
  onCommit: (draft: BomLineDraft) => Promise<boolean>;
  onDelete: (node: BomLineRow) => void;
}) {
  const collapsed = collapsedIds.has(node.id);
  const showNewChildRow = canEdit && !collapsed && (node.isAssembly || childEntryIds.has(node.id));

  return (
    <>
      <BomRow
        depth={node.depth}
        initial={{
          id: node.id,
          parentId: node.parentId,
          name: node.name,
          vendor: node.vendor,
          partNumber: node.partNumber,
          qty: node.qty,
          unitPrice: node.unitPrice,
          currency: node.currency,
          fxRate: node.fxRate,
          deliveryDate: node.deliveryDate,
          note: node.note,
        }}
        disablePrice={node.isAssembly}
        extendedTwd={node.extendedTwd}
        canEdit={canEdit}
        cols={cols}
        vendorListId="bom-vendors"
        onCommit={onCommit}
        leading={
          node.isAssembly ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => toggleCollapse(node.id)}
              className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : (
            <span className="inline-block w-[18px] shrink-0" />
          )
        }
        actions={
          canEdit && (
            <>
              <button
                type="button"
                title="新增子項目"
                onClick={() => revealChildEntry(node.id)}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800"
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                title="刪除"
                onClick={() => onDelete(node)}
                className="rounded p-1 text-neutral-300 hover:text-red-600 dark:text-neutral-600"
              >
                <Trash2 size={13} />
              </button>
            </>
          )
        }
      />
      {!collapsed &&
        node.children.map((child) => (
          <BomNodeRows
            key={child.id}
            node={child}
            canEdit={canEdit}
            cols={cols}
            collapsedIds={collapsedIds}
            childEntryIds={childEntryIds}
            toggleCollapse={toggleCollapse}
            revealChildEntry={revealChildEntry}
            onCommit={onCommit}
            onDelete={onDelete}
          />
        ))}
      {showNewChildRow && (
        <BomRow
          key={`new-${node.id}`}
          depth={node.depth + 1}
          initial={{ parentId: node.id, ...NEW_ROW_BLANK }}
          disablePrice={false}
          extendedTwd={null}
          canEdit={canEdit}
          cols={cols}
          vendorListId="bom-vendors"
          onCommit={onCommit}
          leading={<span className="inline-block w-[18px] shrink-0" />}
        />
      )}
    </>
  );
}

/**
 * 樣機 BOM:某個產品、某個階段一份表。列廠商/型號/名稱,可以往下分子集,
 * 最後在頁尾算出一台裝置多少錢。
 *
 * 產品跟階段用同一組下拉,跟樣機計畫共用同一組階段 —— EVT 兩台給 SW 做
 * mock up,料號要對的也是那個 EVT 的 BOM。
 *
 * 編輯是 Excel 式的:直接在欄位裡打資訊,焦點離開那一列就送出,沒有另外
 * 的新增/編輯彈窗,也沒有「新增最上層項目」按鈕——最下面永遠有一列空白
 * 列在等,打了名稱就變成一筆新項目。
 */
export function BomTable({ boardId }: { boardId: string }) {
  const { notify, confirm, prompt } = useDialogs();
  const [ctx, setCtx] = useState<BomContext | null>(null);
  const [product, setProduct] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [view, setView] = useState<BomView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [childEntryIds, setChildEntryIds] = useState<Set<string>>(new Set());
  const [showAllCols, setShowAllCols] = useState(false);
  const [newBomOpen, setNewBomOpen] = useState(false);
  const [paste, setPaste] = useState<{ open: boolean; text: string }>({ open: false, text: "" });

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

  async function run(work: () => Promise<{ error?: string }>, failTitle: string): Promise<boolean> {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return false;
      }
      await reload();
      // 產品/階段的候選清單可能因為這次操作多了一個新名字,一併重讀。
      setCtx(await getBomContext(boardId));
      return true;
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : failTitle }
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  function commit(draft: BomLineDraft): Promise<boolean> {
    return run(() => upsertBomLine(boardId, product, phaseId, draft), draft.id ? "無法儲存" : "無法新增");
  }

  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function revealChildEntry(id: string) {
    setChildEntryIds((prev) => new Set(prev).add(id));
    setCollapsedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
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

  /** 新增產品:問名字、建起來、切過去——產品可以先建、之後再填 BOM。 */
  async function addNewProduct() {
    const name = await prompt("產品名稱?(例如 M3、充電站)", {
      title: "新增產品",
      placeholder: "產品名稱",
      required: true,
      confirmLabel: "新增",
    });
    if (name === null || name.trim() === "") return;
    if (await run(() => addProduct(boardId, name), "無法新增產品")) setProduct(name.trim());
  }

  /** 修改產品名稱:問新名字,看板上用到這個名字的地方(BOM、樣機計畫)一起換,然後切到新名字。 */
  async function renameCurrentProduct() {
    const name = await prompt(`把產品「${product}」改名為?(BOM 與樣機計畫裡的名字會一起換)`, {
      title: "修改產品名稱",
      defaultValue: product,
      required: true,
      confirmLabel: "改名",
    });
    if (name === null || name.trim() === "" || name.trim() === product) return;
    if (await run(() => renameProduct(boardId, product, name), "無法修改產品名稱")) setProduct(name.trim());
  }

  /** 刪除產品:先說會一併刪掉多少 BOM 與樣機計畫,確認了才刪。 */
  async function removeProduct() {
    const usage = await getProductUsage(boardId, product);
    if ("error" in usage) {
      await notify(usage.error, { title: "無法刪除產品" });
      return;
    }
    const detail =
      usage.bomLines + usage.protoRows === 0
        ? "這個產品還沒有 BOM 與樣機計畫。"
        : `會一併刪掉它在 ${usage.phases} 個階段的 ${usage.bomLines} 筆 BOM(含子項目)與 ${usage.protoRows} 列樣機計畫,無法復原。` +
          (usage.protoUnits > 0
            ? `\n\n樣機計畫排出來的 ${usage.protoUnits} 台樣機也會一併拿掉${
                usage.usedByItems > 0 ? `;其中 ${usage.usedByItems} 個工作項正在使用,它們的「使用樣機」會一併解除` : ""
              }。`
            : "");
    const ok = await confirm(`刪除產品「${product}」?\n\n${detail}`, {
      title: "刪除產品",
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    if (await run(() => deleteProduct(boardId, product), "無法刪除產品")) {
      const fresh = await getBomContext(boardId);
      setProduct(fresh?.products[0] ?? "");
    }
  }

  /** 新增 BOM 視窗送出:成功就切到那份;失敗把說明交回視窗留在那裡。 */
  async function submitNewBom(
    newProduct: string,
    newPhaseId: string,
    source: { product: string; phaseId: string } | null
  ): Promise<string | null> {
    setBusy(true);
    try {
      const result = await createBom(boardId, newProduct, newPhaseId, source);
      if (result.error) return result.error;
      setProduct(newProduct);
      setPhaseId(newPhaseId);
      setCtx(await getBomContext(boardId));
      return null;
    } catch (err) {
      return isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗";
    } finally {
      setBusy(false);
    }
  }

  /** 貼上視窗送出:接在現有的列後面;有略過的列說一聲。 */
  async function submitPaste(rows: Parameters<typeof pasteBomLines>[3]): Promise<string | null> {
    setBusy(true);
    try {
      const result = await pasteBomLines(boardId, product, phaseId, rows);
      if (result.error) return result.error;
      await reload();
      setCtx(await getBomContext(boardId));
      if (result.skipped && result.skipped.length > 0) {
        await notify([`貼上了 ${result.created} 列,${result.skipped.length} 列略過:`, ...result.skipped.slice(0, 10).map((w) => `• ${w}`)].join("\n"), {
          title: "貼上 BOM",
        });
      }
      return null;
    } catch (err) {
      return isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗";
    } finally {
      setBusy(false);
    }
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

  async function onBomImported() {
    await reload();
    // 匯入可能一次動到很多產品/階段,候選清單也要一併重讀。
    setCtx(await getBomContext(boardId));
  }

  const roots = view?.lines.filter((l) => l.depth === 0) ?? [];
  // 次要欄位(匯率、交期、備註)預設收起來,表格才放得進一個畫面;這一份有資料、或使用者要看就顯示。
  const cols: BomColumns = {
    fx: showAllCols || (view?.lines.some((l) => l.currency !== "TWD") ?? false),
    delivery: showAllCols || (view?.lines.some((l) => !!l.deliveryDate) ?? false),
    note: showAllCols || (view?.lines.some((l) => !!l.note) ?? false),
  };
  const leadCols = 6 + (cols.fx ? 1 : 0) + (cols.delivery ? 1 : 0); // 名稱、廠商、型號、數量、單價、幣別(+匯率、交期),小計之前
  const totalCols = leadCols + 1 + (cols.note ? 1 : 0) + (ctx.canEdit ? 1 : 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        某個產品、某個階段要用的料:廠商、型號、名稱,可以往下分子集(電池模組底下再掛零件)。算出單台成本;
        乘上「樣機計畫」排的台數,就是這個階段的材料預算(自動寫進「階段預算」)。直接在欄位裡打資訊,離開那一列就存檔。
      </p>

      <BomExcelButtons boardId={boardId} canEdit={ctx.canEdit} onImported={onBomImported} />

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">產品</span>
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            title="產品名稱來自「新增產品」、「樣機計畫」、「樣機 BOM」三處;括號是這個名字出現在哪裡"
            className="max-w-64 rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
          >
            {ctx.products.length === 0 && <option value="">還沒有產品</option>}
            {ctx.products.map((p) => (
              <option key={p} value={p}>
                {p}({(ctx.productSources[p] ?? []).map((s) => PRODUCT_SOURCE_LABELS[s]).join("、")})
              </option>
            ))}
          </select>
          <datalist id="bom-vendors">
            {ctx.vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        {ctx.canEdit && (
          <>
            <button
              type="button"
              onClick={() => setNewBomOpen(true)}
              disabled={busy}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              title="選產品與階段,從空白或複製一份現有的 BOM 開始"
            >
              <Plus size={12} /> 新增 BOM
            </button>
            <button
              type="button"
              onClick={() => setPaste({ open: true, text: "" })}
              disabled={busy || !product}
              className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
              title="從 Excel 複製整張表貼進來,一次新增多列"
            >
              <ClipboardPaste size={12} /> 從 Excel 貼上
            </button>
            <button
              type="button"
              onClick={() => void addNewProduct()}
              disabled={busy}
              className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              <Plus size={12} /> 新增產品
            </button>
            <button
              type="button"
              onClick={() => void renameCurrentProduct()}
              disabled={busy || !product || !ctx.products.includes(product)}
              title={product && !ctx.products.includes(product) ? "這個名字還不是一個產品" : "修改這個產品的名稱(BOM 與樣機計畫一起換)"}
              className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              <Pencil size={12} /> 修改名稱
            </button>
            <button
              type="button"
              onClick={() => void removeProduct()}
              disabled={busy || !product || !ctx.products.includes(product)}
              title={product && !ctx.products.includes(product) ? "這個名字還不是一個產品" : "連同它的 BOM 與樣機計畫一起刪除"}
              className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-neutral-600 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <Trash2 size={12} /> 刪除產品
            </button>
          </>
        )}
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

          {view.lineCount > 0 && view.planQty === 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <p>
                「樣機計畫」裡還沒有排「{view.product}」在「{ctx.phases.find((p) => p.id === phaseId)?.name ?? ""}」的台數,所以這個產品不會算進這個階段的材料預算——
                材料預算 = 單台成本 × 樣機計畫的台數。請到「樣機計畫」填台數(產品名稱要跟這裡的一模一樣)。
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 text-xs text-neutral-500 dark:text-neutral-400">
            <span>
              {ctx.canEdit && "表格上直接按 Ctrl+V,可以把 Excel 複製的整張表貼進來。"}
            </span>
            <label className="flex shrink-0 items-center gap-1.5">
              <input type="checkbox" checked={showAllCols} onChange={(e) => setShowAllCols(e.target.checked)} />
              顯示匯率、交期、備註
            </label>
          </div>

          <div
            className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700"
            onPaste={(e) => {
              if (!ctx.canEdit) return;
              const text = e.clipboardData.getData("text/plain");
              // 單一格的文字照常貼進輸入框;多格(有 Tab 或換行)才當成一張表。
              if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
              e.preventDefault();
              setPaste({ open: true, text });
            }}
          >
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">名稱</th>
                  <th className="px-3 py-2 text-left font-medium">廠商</th>
                  <th className="px-3 py-2 text-left font-medium">型號/料號</th>
                  <th className="px-3 py-2 text-right font-medium">數量</th>
                  <th className="px-3 py-2 text-right font-medium">單價</th>
                  <th className="px-3 py-2 text-center font-medium">幣別</th>
                  {cols.fx && <th className="px-3 py-2 text-right font-medium">匯率</th>}
                  {cols.delivery && <th className="px-3 py-2 text-left font-medium">交期</th>}
                  <th className="px-3 py-2 text-right font-medium">小計(台幣)</th>
                  {cols.note && <th className="px-3 py-2 text-left font-medium">備註</th>}
                  {view.canEdit && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {roots.length === 0 && !view.canEdit && (
                  <tr>
                    <td colSpan={totalCols} className="px-3 py-8 text-center text-neutral-400 dark:text-neutral-500">
                      這個產品在這個階段還沒有 BOM。
                    </td>
                  </tr>
                )}
                {roots.map((root) => (
                  <BomNodeRows
                    key={root.id}
                    node={root}
                    canEdit={view.canEdit}
                    cols={cols}
                    collapsedIds={collapsedIds}
                    childEntryIds={childEntryIds}
                    toggleCollapse={toggleCollapse}
                    revealChildEntry={revealChildEntry}
                    onCommit={commit}
                    onDelete={removeLine}
                  />
                ))}
                {view.canEdit && (
                  <BomRow
                    key="new-root"
                    depth={0}
                    initial={{ parentId: null, ...NEW_ROW_BLANK }}
                    disablePrice={false}
                    extendedTwd={null}
                    canEdit={view.canEdit}
                    cols={cols}
                    vendorListId="bom-vendors"
                    onCommit={commit}
                    leading={<span className="inline-block w-[18px] shrink-0" />}
                  />
                )}
              </tbody>
              <tfoot className="border-t-2 border-neutral-300 dark:border-neutral-600">
                <tr>
                  <td colSpan={leadCols} className="px-3 py-2 text-right font-semibold text-neutral-800 dark:text-neutral-100">
                    單台成本
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
                    {formatMoney(view.unitCostTwd)}
                  </td>
                  {cols.note && <td />}
                  {view.canEdit && <td />}
                </tr>
                {view.lineCount > 0 && (
                  <tr>
                    <td colSpan={leadCols} className="px-3 pb-2 text-right text-xs text-neutral-500 dark:text-neutral-400">
                      × 樣機計畫排的台數 {view.planQty} 台 = 這個產品算進這個階段材料預算的錢
                    </td>
                    <td className="px-3 pb-2 text-right text-xs font-medium tabular-nums text-neutral-700 dark:text-neutral-200">
                      {formatMoney(Math.round(view.unitCostTwd * view.planQty))}
                    </td>
                    {cols.note && <td />}
                    {view.canEdit && <td />}
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </>
      )}

      <NewBomDialog
        open={newBomOpen}
        onOpenChange={setNewBomOpen}
        products={ctx.products}
        phases={ctx.phases}
        sources={ctx.sources}
        defaultProduct={product}
        defaultPhaseId={phaseId}
        onSubmit={submitNewBom}
      />
      <BomPasteDialog
        open={paste.open}
        onOpenChange={(open) => setPaste((cur) => ({ ...cur, open }))}
        initialText={paste.text}
        product={product}
        phaseName={ctx.phases.find((p) => p.id === phaseId)?.name ?? ""}
        onApply={submitPaste}
      />
    </div>
  );
}
