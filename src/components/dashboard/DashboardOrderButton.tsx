"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ListOrdered, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { saveDashboardOrder } from "@/lib/actions/dashboardOrder";
import { moveSection } from "@/lib/dashboardSections";
import { saveDashboardTabs } from "@/lib/actions/dashboardTabs";
import {
  MAX_DASHBOARD_TABS,
  MAX_TAB_NAME,
  PRESET_TAB_NAMES,
  assignSection,
  newTabId,
  tabOfSection,
  type DashboardTab,
} from "@/lib/dashboardTabs";

type Row = { id: string; label: string };

/**
 * 「排列順序」:每個人自己決定儀表板先看哪一塊,順序記在帳號上(換電腦也一樣)。
 * 每按一下上移 / 下移就存一次——區塊不多,不用另外的「儲存」按鈕;「還原預設」清掉自己的排法。
 * 管理者代操作別人的帳號時只能看、不能改(那是對方自己的偏好)。
 */
export function DashboardOrderButton({
  sections,
  defaultSections,
  tabs: savedTabs,
  readOnlyReason,
}: {
  /** 現在畫面上的區塊,由上到下(已經套用這個人存的順序)。 */
  sections: Row[];
  /** 預設順序的同一批區塊,「還原預設」要回到這個。 */
  defaultSections: Row[];
  /** 這個人自己建的子類(分頁),以及每個區塊歸在哪一類。 */
  tabs: DashboardTab[];
  /** 有值就不能改,顯示這句話。 */
  readOnlyReason?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(sections);
  const [error, setError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<DashboardTab[]>(savedTabs);

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

  /** 子類的改動(新增、改名、刪除、歸類)每改一次就存一次,跟順序同一個做法。 */
  async function persistTabs(next: DashboardTab[]) {
    const before = tabs;
    setTabs(next);
    setError(null);
    const result = await saveDashboardTabs(next);
    if (result.error) {
      setError(result.error);
      setTabs(before);
      return;
    }
    router.refresh();
  }

  function addTab() {
    // 名稱自動帶一個還沒用過的建議名稱(個人 / 團隊 / 樣機),沒有了就叫「新子類」,之後都可以改。
    const used = new Set(tabs.map((t) => t.name));
    const name = PRESET_TAB_NAMES.find((n) => !used.has(n)) ?? `新子類${tabs.length + 1}`;
    void persistTabs([...tabs, { id: newTabId(), name, sections: [] }]);
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
          setTabs(savedTabs);
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

        <div className="mb-4 rounded border border-neutral-200 p-2 dark:border-neutral-700" data-dashboard-tabs-editor>
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            <b>子類(分頁)</b>:儀表板上方會多出分頁,只看歸給那一類的區塊;「全部」永遠看得到所有區塊。名稱可以選建議的,也可以自己輸入。
          </p>
          <ul className="space-y-1">
            {tabs.map((tab) => (
              <li key={tab.id} className="flex items-center gap-2" data-dashboard-tab-row={tab.id}>
                <input
                  list="dashboard-tab-presets"
                  defaultValue={tab.name}
                  maxLength={MAX_TAB_NAME}
                  disabled={!!readOnlyReason}
                  aria-label="子類名稱"
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (!name || name === tab.name) {
                      e.target.value = tab.name;
                      return;
                    }
                    if (tabs.some((t) => t.id !== tab.id && t.name.toLowerCase() === name.toLowerCase())) {
                      setError(`已經有一個叫「${name}」的子類`);
                      e.target.value = tab.name;
                      return;
                    }
                    void persistTabs(tabs.map((t) => (t.id === tab.id ? { ...t, name } : t)));
                  }}
                  className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
                />
                <span className="shrink-0 text-xs text-neutral-400">{tab.sections.length} 塊</span>
                <button
                  type="button"
                  disabled={!!readOnlyReason}
                  onClick={() => void persistTabs(tabs.filter((t) => t.id !== tab.id))}
                  aria-label={`刪除子類「${tab.name}」`}
                  title="刪除這個子類(區塊不會不見,只是回到沒歸類,在「全部」還是看得到)"
                  className="rounded p-1 text-neutral-400 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          <datalist id="dashboard-tab-presets">
            {PRESET_TAB_NAMES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <button
            type="button"
            disabled={!!readOnlyReason || tabs.length >= MAX_DASHBOARD_TABS}
            onClick={addTab}
            data-dashboard-tab-add
            className="mt-2 flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <Plus size={12} /> 新增子類
          </button>
        </div>
        <ol className="space-y-1" data-dashboard-order-list>
          {rows.map((row, index) => (
            <li
              key={row.id}
              data-section-id={row.id}
              className="flex items-center gap-2 rounded border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700"
            >
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-neutral-400">{index + 1}</span>
              <span className="min-w-0 flex-1 text-neutral-800 dark:text-neutral-100">{row.label}</span>
              {tabs.length > 0 && (
                <select
                  value={tabOfSection(tabs, row.id) ?? ""}
                  disabled={!!readOnlyReason}
                  onChange={(e) => void persistTabs(assignSection(tabs, row.id, e.target.value || null))}
                  aria-label={`「${row.label}」歸在哪一類`}
                  data-section-tab
                  className="w-24 shrink-0 rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
                >
                  <option value="">不歸類</option>
                  {tabs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
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
