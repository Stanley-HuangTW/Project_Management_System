"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { COMMON_PROTO_UNITS } from "@/lib/protoPlan";
import type { OrgUnit } from "@/lib/orgUnits";

/** 「其他」那一項的值。空字串會跟「沒選」混在一起,所以給它一個名字。 */
const CUSTOM = "__custom__";

/**
 * 新增一列樣機用途。
 *
 * 用途下拉分兩組:公司組織單位(系統設定裡那份)跟常見的用途。兩組都有,
 * 是因為吃樣機的不只工程單位 —— field test、業務、工廠 golden sample 都會
 * 吃,那些不是組織單位。所以最後還留一個「其他」讓人自己打。
 */
export function ProtoRowDialog({
  open,
  onOpenChange,
  units,
  /** 從某個產品那一列按進來的話,產品先填好。 */
  defaultProduct,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: OrgUnit[];
  defaultProduct?: string;
  onSubmit: (product: string, unit: string) => void;
}) {
  const [product, setProduct] = useState("");
  const [choice, setChoice] = useState("");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 在 render 當下對齊,不放進 effect —— effect 版本會先用上一次的值畫一次。
  const key = open ? `${defaultProduct ?? ""}` : null;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (key !== prevKey) {
    setPrevKey(key);
    setProduct(defaultProduct ?? "");
    setChoice(units[0]?.code ?? COMMON_PROTO_UNITS[0]);
    setCustom("");
    setError(null);
  }

  function submit() {
    const name = product.trim();
    if (!name) return setError("產品不可為空");
    const unit = choice === CUSTOM ? custom.trim() : choice;
    if (!unit) return setError("用途不可為空");
    onSubmit(name, unit);
    onOpenChange(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="新增樣機用途">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">產品</span>
          <input
            autoFocus
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="例如 M3、充電站"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">用途</span>
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className={field}>
            {units.length > 0 && (
              <optgroup label="公司組織單位">
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.label}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="常見用途">
              {COMMON_PROTO_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </optgroup>
            <option value={CUSTOM}>其他(自行輸入)</option>
          </select>
        </label>

        {choice === CUSTOM && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
              自訂用途
            </span>
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="例如 Field test - JP"
              className={field}
            />
          </label>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
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
    </Modal>
  );
}
