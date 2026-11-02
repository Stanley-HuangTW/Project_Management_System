"use client";

import { useState } from "react";

/**
 * 樣機計畫上的一個名稱——一列的用途單位,或一個區塊標題的產品名稱(kind="product"):有編輯權的人點一下就能改,
 * 按 Enter 或點別處存檔(空的或沒改就放棄)。
 * 存檔失敗的提示由 onSave 自己負責。
 */
export function ProtoUnitName({
  value,
  canEdit,
  onSave,
  kind = "unit",
}: {
  value: string;
  canEdit: boolean;
  onSave: (next: string) => Promise<void>;
  kind?: "unit" | "product";
}) {
  const attr = `data-proto-${kind}`;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!canEdit) return <span>{value}</span>;

  async function finish() {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === value) return;
    await onSave(next);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={100}
        {...{ [`${attr}-input`]: value }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void finish()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-full rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      {...{ [`${attr}-name`]: value }}
      title={`點一下修改${kind === "unit" ? "用途單位" : "產品"}名稱`}
      className="cursor-text rounded px-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700"
    >
      {value}
    </button>
  );
}
