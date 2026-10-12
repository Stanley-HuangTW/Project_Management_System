"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

const field =
  "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

type Source = { product: string; phaseId: string; count: number };

/**
 * 新增一份 BOM(某個產品、某個階段)——一步選好產品與階段,可以直接打一個新的產品名,
 * 也可以選一份現有的 BOM(任何產品、任何階段)整份複製當起點,不用先分別新增產品、選階段、再去找空白列。
 * 目標已經有 BOM 時由伺服器擋下來說明,不會靜靜蓋掉。
 */
export function NewBomDialog({
  open,
  onOpenChange,
  products,
  phases,
  sources,
  defaultProduct,
  defaultPhaseId,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: string[];
  phases: { id: string; name: string }[];
  sources: Source[];
  defaultProduct: string;
  defaultPhaseId: string;
  /** 回傳錯誤說明就留在視窗;null = 成功,視窗關掉。 */
  onSubmit: (product: string, phaseId: string, source: { product: string; phaseId: string } | null) => Promise<string | null>;
}) {
  const [product, setProduct] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [from, setFrom] = useState(""); // "" = 空白;其他 = 在 sources 裡的第幾份
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 打開的當下對齊預設值,不放進 effect——effect 版本會先用上一次的值畫一次。
  const key = open ? `${defaultProduct}|${defaultPhaseId}` : null;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (key !== prevKey) {
    setPrevKey(key);
    setProduct(defaultProduct);
    setPhaseId(defaultPhaseId || phases[0]?.id || "");
    setFrom("");
    setError(null);
  }

  const phaseName = (id: string) => phases.find((p) => p.id === id)?.name ?? "";
  const name = product.trim();
  const isNewProduct = name !== "" && !products.includes(name);
  const candidates = sources.map((s, i) => ({ ...s, index: i })).filter((s) => !(s.product === name && s.phaseId === phaseId));

  async function submit() {
    if (busy) return;
    if (!name) return setError("請填產品名稱");
    if (!phaseId) return setError("請選階段");
    const picked = from === "" ? undefined : sources[Number(from)];
    const source = picked ? { product: picked.product, phaseId: picked.phaseId } : null;
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit(name, phaseId, source);
      if (message) setError(message);
      else onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="新增 BOM">
      <div className="space-y-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          一份 BOM 是「某個產品在某個階段」要用的料。選好產品與階段,可以從空白開始,也可以複製一份現有的當起點再改。
        </p>
        <label className="block text-xs text-neutral-500 dark:text-neutral-400">
          產品(點下面現有的,或直接打新的名字)
          <input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="例如 M3、充電站"
            className={`${field} mt-1`}
            autoFocus
          />
        </label>
        {products.length > 0 && (
          <div className="-mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span>現有產品:</span>
            {products.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProduct(p)}
                className={`rounded-full border px-2 py-0.5 ${
                  p === name
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    : "border-neutral-300 hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {isNewProduct && <p className="-mt-1 text-[11px] text-blue-600 dark:text-blue-400">「{name}」是新產品,會一起建立。</p>}
        <label className="block text-xs text-neutral-500 dark:text-neutral-400">
          階段
          <select value={phaseId} onChange={(e) => setPhaseId(e.target.value)} className={`${field} mt-1`}>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-neutral-500 dark:text-neutral-400">
          從哪裡開始
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} mt-1`}>
            <option value="">空白(自己一列一列填,或之後從 Excel 貼上)</option>
            {candidates.map((s) => (
              <option key={s.index} value={String(s.index)}>
                複製「{s.product}」在「{phaseName(s.phaseId)}」的 BOM({s.count} 列)
              </option>
            ))}
          </select>
        </label>
        {error && <p className="whitespace-pre-line text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !name}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "建立中..." : "建立"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
