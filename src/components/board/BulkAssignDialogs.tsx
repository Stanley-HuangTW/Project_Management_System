"use client";

import { useMemo, useState } from "react";
import { Cpu, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { bulkAssignUsers, bulkSetProtoUnits, type BulkAssignResult } from "@/lib/actions/bulkAssign";
import { PercentInput } from "@/components/ui/PercentInput";
import { UserSelect } from "@/components/ui/UserSelect";
import { useItemProtoUnits } from "./ItemProtoUnitsContext";
import type { UserOption } from "@/types/board";

type Mode = "add" | "remove";

const ghostButton =
  "rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50";
const neutralButton =
  "flex items-center gap-1 rounded-md border border-blue-300 dark:border-blue-700 bg-white dark:bg-neutral-900 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900 disabled:opacity-50";
const primaryButton = "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";

function ModeChoice({
  mode,
  onChange,
  addLabel,
  removeLabel,
  disabled,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  addLabel: string;
  removeLabel: string;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-4" role="radiogroup">
      {(
        [
          ["add", addLabel],
          ["remove", removeLabel],
        ] as const
      ).map(([value, label]) => (
        <label key={value} className="flex items-center gap-1.5">
          <input
            type="radio"
            name="bulk-mode"
            checked={mode === value}
            disabled={disabled}
            onChange={() => onChange(value)}
            className="accent-blue-600"
          />
          {label}
        </label>
      ))}
    </div>
  );
}

/**
 * 選取列上的「指派人員…」「使用樣機…」兩個按鈕,各開一個對話框。表格的批次編輯列與甘特圖的選取列共用,
 * 跑的方式跟狀態欄下拉一樣(run:結果與略過的原因由伺服器逐項檢查後,一次說明)。
 */
export function BulkAssignActions({
  boardId,
  users,
  ids,
  busy,
  run,
}: {
  boardId: string;
  users: UserOption[];
  ids: string[];
  busy: boolean;
  run: (label: string, action: () => Promise<BulkAssignResult>) => Promise<void>;
}) {
  const [dialog, setDialog] = useState<"assign" | "proto" | null>(null);

  async function go(label: string, action: () => Promise<BulkAssignResult>) {
    await run(label, action);
    setDialog(null);
  }

  return (
    <>
      <button type="button" disabled={busy} onClick={() => setDialog("assign")} data-bulk-assign className={neutralButton}>
        <Users size={13} /> 指派人員…
      </button>
      <button type="button" disabled={busy} onClick={() => setDialog("proto")} data-bulk-proto className={neutralButton}>
        <Cpu size={13} /> 使用樣機…
      </button>
      {dialog === "assign" && (
        <BulkAssignDialog
          users={users}
          count={ids.length}
          busy={busy}
          onConfirm={(mode, userId, pct) =>
            go(mode === "add" ? "批次加入人員分配" : "批次移除人員分配", () =>
              bulkAssignUsers(boardId, ids, userId, pct, mode)
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "proto" && (
        <BulkProtoDialog
          count={ids.length}
          busy={busy}
          onConfirm={(mode, protoUnitIds) =>
            go(mode === "add" ? "批次加入使用樣機" : "批次移除使用樣機", () =>
              bulkSetProtoUnits(boardId, ids, protoUnitIds, mode)
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

/** 勾選之後「指派人員」:選一個人,加入(附配置 %)或從勾選的項目移除。 */
export function BulkAssignDialog({
  users,
  count,
  busy,
  onConfirm,
  onClose,
}: {
  users: UserOption[];
  count: number;
  busy: boolean;
  onConfirm: (mode: Mode, userId: string, pct: number) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("add");
  const [userId, setUserId] = useState("");
  const [pct, setPct] = useState(100);
  const name = users.find((u) => u.id === userId)?.name;

  return (
    <Modal open onOpenChange={(open) => !open && !busy && onClose()} title="指派人員">
      <div className="space-y-4 text-sm text-neutral-700 dark:text-neutral-200" data-bulk-assign-dialog>
        <p>
          已選 {count} 項。照一個一個指派的規則處理:你沒有權限的項目會略過並說明原因;新被指派的人每個項目各收到一則通知。
        </p>
        <ModeChoice mode={mode} onChange={setMode} addLabel="加入人員分配" removeLabel="移除人員分配" disabled={busy} />
        <div className="flex flex-wrap items-center gap-2">
          <UserSelect
            users={users}
            value={userId}
            disabled={busy}
            placeholder="選擇人員..."
            onChange={setUserId}
            className="w-56 rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          />
          {mode === "add" && (
            <label className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              配置
              <PercentInput
                value={pct}
                onChange={setPct}
                disabled={busy}
                className="w-16 rounded-md border border-neutral-300 px-1.5 py-1 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
              />
            </label>
          )}
        </div>
        {mode === "add" && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">已經有這個人的項目,配置會改成上面的百分比。</p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className={ghostButton}>
            取消
          </button>
          <button
            type="button"
            data-bulk-assign-confirm
            disabled={busy || !userId}
            onClick={() => onConfirm(mode, userId, pct)}
            className={primaryButton}
          >
            {busy ? "處理中…" : mode === "add" ? `把 ${name ?? "他"} 加到 ${count} 項` : `從 ${count} 項移除 ${name ?? "他"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 勾選之後「使用樣機」:選幾台樣機,加入或從勾選的項目移除。 */
export function BulkProtoDialog({
  count,
  busy,
  onConfirm,
  onClose,
}: {
  count: number;
  busy: boolean;
  onConfirm: (mode: Mode, protoUnitIds: string[]) => void;
  onClose: () => void;
}) {
  const protoUnits = useItemProtoUnits();
  const options = useMemo(() => protoUnits?.options ?? [], [protoUnits]);
  const [mode, setMode] = useState<Mode>("add");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [needle, setNeedle] = useState("");
  const shown = useMemo(() => {
    const q = needle.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, needle]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal open onOpenChange={(open) => !open && !busy && onClose()} title="使用樣機">
      <div className="space-y-4 text-sm text-neutral-700 dark:text-neutral-200" data-bulk-proto-dialog>
        <p>已選 {count} 項。加入:在每一項原本選的樣機上再多加;移除:只拿掉你勾的樣機,其他不動。</p>
        <ModeChoice mode={mode} onChange={setMode} addLabel="加入這些樣機" removeLabel="移除這些樣機" disabled={busy} />
        {options.length === 0 ? (
          <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            這個看板的樣機計畫還沒有排出任何一台樣機(到預算頁的「樣機計畫」設定台數)。
          </p>
        ) : (
          <>
            <input
              value={needle}
              disabled={busy}
              onChange={(e) => setNeedle(e.target.value)}
              placeholder="搜尋樣機..."
              className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
            />
            <ul className="max-h-60 space-y-0.5 overflow-auto rounded-md border border-neutral-200 p-1 dark:border-neutral-700">
              {shown.map((o) => (
                <li key={o.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                    <input
                      type="checkbox"
                      checked={picked.has(o.id)}
                      disabled={busy}
                      onChange={() => toggle(o.id)}
                      data-bulk-proto-option={o.id}
                      className="accent-blue-600"
                    />
                    {o.label}
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="px-2 py-1 text-xs text-neutral-400">沒有符合的樣機</li>}
            </ul>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className={ghostButton}>
            取消
          </button>
          <button
            type="button"
            data-bulk-proto-confirm
            disabled={busy || picked.size === 0}
            onClick={() => onConfirm(mode, [...picked])}
            className={primaryButton}
          >
            {busy ? "處理中…" : `${mode === "add" ? "加入" : "移除"} ${picked.size} 台到 ${count} 項`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
