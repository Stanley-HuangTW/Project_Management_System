"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { BomLineDraft } from "@/lib/actions/bom";

export type BomLineOption = { id: string; name: string; depth: number };

/**
 * 新增/編輯一筆 BOM 項目。
 *
 * 有子項目的上層不能自己填單價——那個數字是底下加起來的,兩邊都填會有一
 * 個永遠對不起來的數字。所以「上層」選好之後,單價/幣別/匯率那幾欄不是
 * 隱藏,而是換成一句提示,免得使用者以為欄位消失是哪裡壞了。
 */
export function BomLineDialog({
  open,
  onOpenChange,
  title,
  initial,
  /** 排除掉自己與自己的子孫——不能把自己的子項目選成自己的上層。 */
  parentOptions,
  hasChildren,
  onDelete,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial?: BomLineDraft;
  parentOptions: BomLineOption[];
  /** 編輯既有列時,它底下現在有沒有子項目——有的話單價欄位就該提示而不是輸入。 */
  hasChildren: boolean;
  onDelete?: () => void;
  onSubmit: (draft: BomLineDraft) => void;
}) {
  const [parentId, setParentId] = useState<string>("");
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [currency, setCurrency] = useState("TWD");
  const [fxRate, setFxRate] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const key = open ? `${title}|${initial?.id ?? "new"}` : null;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (key !== prevKey) {
    setPrevKey(key);
    setParentId(initial?.parentId ?? "");
    setName(initial?.name ?? "");
    setVendor(initial?.vendor ?? "");
    setPartNumber(initial?.partNumber ?? "");
    setQty(initial ? String(initial.qty) : "1");
    setUnitPrice(initial ? String(initial.unitPrice) : "");
    setCurrency(initial?.currency ?? "TWD");
    setFxRate(initial ? String(initial.fxRate) : "1");
    setNote(initial?.note ?? "");
    setError(null);
  }

  const isAssembly = hasChildren;

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError("名稱不可為空");
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) return setError("數量必須大於 0");
    const priceNum = isAssembly ? 0 : Number(unitPrice);
    if (!isAssembly && (!Number.isFinite(priceNum) || priceNum < 0)) {
      return setError("單價必須是 0 或正數");
    }
    const fxNum = currency.trim().toUpperCase() === "TWD" ? 1 : Number(fxRate);
    if (!isAssembly && (!Number.isFinite(fxNum) || fxNum <= 0)) return setError("匯率必須大於 0");

    onSubmit({
      id: initial?.id,
      parentId: parentId || null,
      name: trimmed,
      vendor: vendor.trim(),
      partNumber: partNumber.trim(),
      qty: qtyNum,
      unitPrice: priceNum,
      currency: currency.trim().toUpperCase() || "TWD",
      fxRate: fxNum,
      note: note.trim(),
    });
    onOpenChange(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
            上層(子集)
          </span>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={field}>
            <option value="">(最上層)</option>
            {parentOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {"　".repeat(o.depth)}
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">名稱</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="例如 主機板、螺絲 M3x8"
            className={field}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">廠商</span>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">型號/料號</span>
            <input
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
              className={field}
            />
          </label>
        </div>

        <label className="block w-28">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
            數量(上一層要用幾個)
          </span>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
            className={field}
          />
        </label>

        {isAssembly ? (
          <p className="rounded-md border border-dashed border-neutral-200 p-2 text-xs text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
            這一項底下已經有子項目,單價由子項目加總算出來,這裡不能再手動輸入。要改單價,請改底下
            那些子項目。
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">單價</span>
              <input
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                inputMode="decimal"
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">幣別</span>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">匯率</span>
              <input
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                disabled={currency.trim().toUpperCase() === "TWD"}
                inputMode="decimal"
                className={`${field} disabled:opacity-50`}
              />
            </label>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">備註</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {onDelete ? (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onDelete();
              }}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
            >
              刪除
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              確定
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
