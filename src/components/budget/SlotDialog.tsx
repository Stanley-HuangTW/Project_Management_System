"use client";

import { UserSelect } from "@/components/ui/UserSelect";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { guessUnitCode, type OrgUnit } from "@/lib/orgUnits";

export type SlotDraft = {
  discipline: string;
  label: string;
  func: string;
  /** null = 還沒招到人,那一列顯示 ownerLabel(預設 TBH)。 */
  userId: string | null;
  ownerLabel: string;
};

export type SlotUserOption = { id: string; name: string };

/**
 * 新增或修改一個人力名額。
 *
 * 單位本來是從代號猜的 —— 「EE1」猜 EE、猜不到就丟進「其他」。猜錯了畫面上
 * 也看不出來,人月就靜靜地算到別的單位頭上。改成明講:代號還是自由填,單位
 * 用選的,而且選項就是系統設定裡那份組織單位。
 */
export function SlotDialog({
  open,
  onOpenChange,
  units,
  users,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: OrgUnit[];
  /** 名額可以指給誰。 */
  users: SlotUserOption[];
  /** 有值 = 修改;沒有 = 新增。 */
  initial?: SlotDraft;
  onSubmit: (draft: SlotDraft) => void;
}) {
  const fallback = units[0]?.code ?? "";
  const [label, setLabel] = useState("");
  const [discipline, setDiscipline] = useState(fallback);
  const [func, setFunc] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [ownerLabel, setOwnerLabel] = useState("TBH");
  const [touchedUnit, setTouchedUnit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 在 render 當下對齊,不放進 effect —— effect 版本會先用上一次的值畫一次。
  const key = open ? `${initial?.label ?? ""}|${initial?.discipline ?? ""}` : null;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (key !== prevKey) {
    setPrevKey(key);
    setLabel(initial?.label ?? "");
    setDiscipline(initial?.discipline ?? fallback);
    setFunc(initial?.func ?? "");
    setUserId(initial?.userId ?? null);
    setOwnerLabel(initial?.ownerLabel || "TBH");
    setTouchedUnit(false);
    setError(null);
  }

  /** 打代號的時候順手把單位帶過去,但人一旦自己選過就不再蓋掉他的選擇。 */
  function onLabelChange(next: string) {
    setLabel(next);
    if (touchedUnit || initial) return;
    const guess = guessUnitCode(units, next);
    if (guess) setDiscipline(guess);
  }

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) return setError("名額代號不可為空,例如 EE1");
    if (!discipline) return setError("請先到系統設定新增組織單位");
    onSubmit({
      discipline,
      label: trimmed,
      func: func.trim(),
      userId,
      ownerLabel: ownerLabel.trim() || "TBH",
    });
    onOpenChange(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={initial ? "修改人力名額" : "新增人力名額"}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">名額代號</span>
          <input
            autoFocus
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="例如 EE1、SW3、ME2"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">組織單位</span>
          <select
            value={discipline}
            onChange={(e) => {
              setTouchedUnit(true);
              setDiscipline(e.target.value);
            }}
            className={field}
          >
            {units.length === 0 && <option value="">(系統設定裡還沒有組織單位)</option>}
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
            職能(選填)
          </span>
          <input
            value={func}
            onChange={(e) => setFunc(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="例如 EEDM、driver、web、PQA"
            className={field}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">人員</span>
          <UserSelect
            users={users}
            value={userId ?? ""}
            onChange={(id) => setUserId(id || null)}
            emptyLabel="未指定(TBH)"
            className={field}
          />
        </label>

        {/* 還沒招到人的時候,那一列要寫什麼由使用者決定 —— 有人寫 TBH,
            有人寫「TBH (Jason 代)」,那是一句給人看的註記。 */}
        {!userId && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
              未指定時顯示
            </span>
            <input
              value={ownerLabel}
              onChange={(e) => setOwnerLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="TBH"
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
