"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { getBomView, type BomLineRow } from "@/lib/actions/bom";
import type { BulkPlaceTarget } from "@/lib/actions/bomBulk";
import { actionErrorMessage } from "@/lib/userError";

const selectClass =
  "w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

/**
 * 勾選之後「移動或複製到…」:選目標那一份 BOM(產品與階段,預設是目前這一份)、目標的上層(最上層或某一列底下)與位置
 * (最後面、最前面、接在某一列後面)。同一份 BOM 內就是重新排序 / 換上層;搬到別份時,列連同子項目換到那一份。
 * 複製不會帶檔案附件。
 */
export function BomBulkMoveDialog({
  open,
  onOpenChange,
  boardId,
  from,
  products,
  phases,
  rootIds,
  subtreeIds,
  selectedCount,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  from: { product: string; phaseId: string };
  products: string[];
  phases: { id: string; name: string }[];
  /** 勾選收斂後的根,與連同子項目一共哪些列。 */
  rootIds: string[];
  subtreeIds: Set<string>;
  selectedCount: number;
  /** 回傳錯誤說明就留在視窗;null = 成功,視窗關掉。 */
  onApply: (mode: "move" | "copy", target: BulkPlaceTarget) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<"move" | "copy">("move");
  const [product, setProduct] = useState(from.product);
  const [phaseId, setPhaseId] = useState(from.phaseId);
  const [parentId, setParentId] = useState("");
  const [position, setPosition] = useState("last");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 打開時重來(目標預設是目前這一份)。
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode("move");
      setProduct(from.product);
      setPhaseId(from.phaseId);
      setParentId("");
      setPosition("last");
      setError(null);
    }
  }

  // 目標那一份 BOM 現有的列,給「上層」與「位置」的下拉選單用。
  const targetKey = open ? `${product}\u0001${phaseId}` : null;
  const [loaded, setLoaded] = useState<{ key: string; lines: BomLineRow[] | null } | null>(null);
  useEffect(() => {
    if (!targetKey) return;
    let cancelled = false;
    (async () => {
      let lines: BomLineRow[] | null = null;
      try {
        lines = (await getBomView(boardId, product, phaseId))?.lines ?? [];
      } catch (e) {
        lines = null;
        if (!cancelled) setError(actionErrorMessage(e, "讀不到目標的 BOM"));
      }
      if (!cancelled) setLoaded({ key: targetKey, lines });
    })();
    return () => {
      cancelled = true;
    };
    // product / phaseId 已經包含在 targetKey 裡。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, targetKey]);

  const lines = targetKey && loaded && loaded.key === targetKey ? loaded.lines : null;
  const sameBom = product === from.product && phaseId === from.phaseId;
  // 同一份 BOM 內「移動」:目標不能是被搬的列自己或它底下的列;「複製」沒有這個限制。
  const blocked = mode === "move" && sameBom ? subtreeIds : new Set<string>();
  const parentOptions = (lines ?? []).filter((l) => !blocked.has(l.id));
  const siblings = (lines ?? []).filter((l) => l.parentId === (parentId || null) && !(mode === "move" && sameBom && rootIds.includes(l.id)));

  function changeTarget(next: { product?: string; phaseId?: string }) {
    if (next.product !== undefined) setProduct(next.product);
    if (next.phaseId !== undefined) setPhaseId(next.phaseId);
    setParentId("");
    setPosition("last");
    setError(null);
  }

  async function apply() {
    if (busy || lines === null) return;
    setBusy(true);
    setError(null);
    try {
      const message = await onApply(mode, {
        product,
        phaseId,
        parentId: parentId || null,
        position: position === "last" ? "last" : position === "first" ? "first" : { after: position.slice("after:".length) },
      });
      if (message) setError(message);
      else onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const label = (l: BomLineRow) => `${"　".repeat(l.depth)}${l.name}`;
  const verb = mode === "move" ? "移動" : "複製";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="移動或複製到…" size="lg">
      <div data-bom-bulk-move className="space-y-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          已選 {selectedCount} 列
          {subtreeIds.size !== selectedCount && `(連同子項目共 ${subtreeIds.size} 列)`}。底下的子項目一起{verb}。
        </p>

        <div className="flex gap-4 text-sm text-neutral-700 dark:text-neutral-200">
          <label className="flex items-center gap-1.5">
            <input data-bom-bulk-mode="move" type="radio" checked={mode === "move"} onChange={() => { setMode("move"); setParentId(""); setPosition("last"); }} /> 移動
          </label>
          <label className="flex items-center gap-1.5">
            <input data-bom-bulk-mode="copy" type="radio" checked={mode === "copy"} onChange={() => { setMode("copy"); setParentId(""); setPosition("last"); }} /> 複製(不帶檔案附件)
          </label>
        </div>

        <div className="flex gap-2">
          <label className="block flex-1 text-xs text-neutral-500 dark:text-neutral-400">
            產品
            <select data-bom-bulk-product value={product} onChange={(e) => changeTarget({ product: e.target.value })} className={`${selectClass} mt-1`}>
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1 text-xs text-neutral-500 dark:text-neutral-400">
            階段
            <select data-bom-bulk-phase value={phaseId} onChange={(e) => changeTarget({ phaseId: e.target.value })} className={`${selectClass} mt-1`}>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {lines === null && !error && <p className="text-xs text-neutral-400 dark:text-neutral-500">讀取目標的 BOM...</p>}

        {lines !== null && (
          <>
            <label className="block text-xs text-neutral-500 dark:text-neutral-400">
              放在哪一列底下
              <select
                data-bom-bulk-parent
                value={parentId}
                onChange={(e) => {
                  setParentId(e.target.value);
                  setPosition("last");
                }}
                className={`${selectClass} mt-1`}
              >
                <option value="">(最上層)</option>
                {parentOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {label(l)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-neutral-500 dark:text-neutral-400">
              位置
              <select data-bom-bulk-position value={position} onChange={(e) => setPosition(e.target.value)} className={`${selectClass} mt-1`}>
                <option value="last">放在最後面</option>
                <option value="first">放在最前面</option>
                {siblings.map((l) => (
                  <option key={l.id} value={`after:${l.id}`}>
                    接在「{l.name}」後面
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

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
            disabled={busy || lines === null}
            onClick={() => void apply()}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? `${verb}中...` : verb}
          </button>
        </div>
      </div>
    </Modal>
  );
}
