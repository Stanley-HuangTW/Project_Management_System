"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ListOrdered } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { saveDashboardOrder } from "@/lib/actions/dashboardOrder";
import { moveSection } from "@/lib/dashboardSections";

type Row = { id: string; label: string };

/**
 * 「排列順序」:每個人自己決定儀表板先看哪一塊,順序記在帳號上(換電腦也一樣)。
 * 每按一下上移 / 下移就存一次——區塊不多,不用另外的「儲存」按鈕;「還原預設」清掉自己的排法。
 * 管理者代操作別人的帳號時只能看、不能改(那是對方自己的偏好)。
 */
export function DashboardOrderButton({
  sections,
  defaultSections,
  readOnlyReason,
}: {
  /** 現在畫面上的區塊,由上到下(已經套用這個人存的順序)。 */
  sections: Row[];
  /** 預設順序的同一批區塊,「還原預設」要回到這個。 */
  defaultSections: Row[];
  /** 有值就不能改,顯示這句話。 */
  readOnlyReason?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(sections);
  const [error, setError] = useState<string | null>(null);

  const labelOf = new Map(defaultSections.map((s) => [s.id, s.label]));

  async function persist(next: Row[], stored: string[]) {
    setRows(next);
    setError(null);
    const result = await saveDashboardOrder(stored);
    if (result.error) {
      setError(result.error);
      setRows(rows);
      return;
    }
    router.refresh();
  }

  function move(id: string, direction: -1 | 1) {
    const ids = moveSection(
      rows.map((r) => r.id),
      id,
      direction
    );
    const next = ids.map((rid) => ({ id: rid, label: labelOf.get(rid) ?? rid }));
    void persist(next, ids);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRows(sections);
          setError(null);
          setOpen(true);
        }}
        data-dashboard-order-button
        className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
        title="決定儀表板的區塊先後順序"
      >
        <ListOrdered size={13} /> 排列順序
      </button>
      <Modal open={open} onOpenChange={setOpen} title="儀表板的排列順序">
        <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          想先看哪一塊,就把它往上移。順序記在你自己的帳號上,不影響別人;之後新增的區塊會接在最後。
        </p>
        {readOnlyReason && <p className="mb-3 text-xs text-amber-600">{readOnlyReason}</p>}
        <ol className="space-y-1" data-dashboard-order-list>
          {rows.map((row, index) => (
            <li
              key={row.id}
              data-section-id={row.id}
              className="flex items-center gap-2 rounded border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700"
            >
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-neutral-400">{index + 1}</span>
              <span className="min-w-0 flex-1 text-neutral-800 dark:text-neutral-100">{row.label}</span>
              <button
                type="button"
                disabled={!!readOnlyReason || index === 0}
                onClick={() => move(row.id, -1)}
                aria-label={`上移「${row.label}」`}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                disabled={!!readOnlyReason || index === rows.length - 1}
                onClick={() => move(row.id, 1)}
                aria-label={`下移「${row.label}」`}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
              >
                <ArrowDown size={14} />
              </button>
            </li>
          ))}
        </ol>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={!!readOnlyReason}
            onClick={() => void persist(defaultSections, [])}
            data-dashboard-order-reset
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            還原預設順序
          </button>
        </div>
      </Modal>
    </>
  );
}
