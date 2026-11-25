"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveRepairInfo } from "@/lib/actions/issueRepair";
import type { IssueCaseDetail, IssueRepairInfo } from "@/lib/issueTypes";
import { actionErrorMessage } from "@/lib/userError";
import { buttonClass, inputClass } from "./issueUi";

type Field = keyof IssueRepairInfo;

/**
 * 維修案件的送修與維修進度:送修方式(郵寄 / 自送)、物流單號、送出與收件日期、配件清點、
 * 現場更換、開始維修與維修完成日期。階段推進時對應的日期沒填會自動帶當天。
 */
export function IssueRepairPanel({ caseId, repair }: { caseId: string; repair: IssueCaseDetail["repair"] }) {
  const router = useRouter();
  const [v, setV] = useState<IssueRepairInfo>({
    shipMethod: repair.shipMethod,
    trackingNo: repair.trackingNo,
    shippedDate: repair.shippedDate,
    receivedDate: repair.receivedDate,
    accessories: repair.accessories,
    onsiteReplace: repair.onsiteReplace,
    repairStartDate: repair.repairStartDate,
    repairDoneDate: repair.repairDoneDate,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const off = !repair.canEdit;
  const set = <K extends Field>(k: K, value: IssueRepairInfo[K]) => setV((cur) => ({ ...cur, [k]: value }));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await saveRepairInfo(caseId, v);
      setMessage({ ok: true, text: "已儲存維修進度" });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: actionErrorMessage(err, "儲存失敗") });
    } finally {
      setBusy(false);
    }
  }

  const dateField = (label: string, k: "shippedDate" | "receivedDate" | "repairStartDate" | "repairDoneDate", testid: string) => (
    <label className="block text-xs text-neutral-500">
      {label}
      <input type="date" disabled={off} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value || null)} className={`${inputClass} mt-1 w-full`} data-testid={testid} />
    </label>
  );

  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900" data-testid="repair-panel" data-issue-repair>
      <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">送修與維修進度</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-neutral-500">
          送修方式
          <select disabled={off} value={v.shipMethod ?? ""} onChange={(e) => set("shipMethod", (e.target.value || null) as IssueRepairInfo["shipMethod"])} className={`${inputClass} mt-1 w-full`} data-testid="repair-ship-method">
            <option value="">未指定</option>
            <option value="MAIL">郵寄</option>
            <option value="HAND">客戶自送</option>
          </select>
        </label>
        <label className="block text-xs text-neutral-500">
          物流單號(郵寄才需要追蹤包裹)
          <input disabled={off} value={v.trackingNo} onChange={(e) => set("trackingNo", e.target.value)} className={`${inputClass} mt-1 w-full`} data-testid="repair-tracking" />
        </label>
        {dateField("送出日期", "shippedDate", "repair-shipped")}
        {dateField("收件日期", "receivedDate", "repair-received")}
        {dateField("開始維修", "repairStartDate", "repair-start")}
        {dateField("維修完成", "repairDoneDate", "repair-done")}
        <label className="block text-xs text-neutral-500 sm:col-span-2">
          配件清點(收到哪些配件、數量、有沒有缺或損壞)
          <textarea disabled={off} rows={3} value={v.accessories} onChange={(e) => set("accessories", e.target.value)} className={`${inputClass} mt-1 w-full`} data-testid="repair-accessories" />
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200 sm:col-span-2">
          <input type="checkbox" disabled={off} checked={v.onsiteReplace} onChange={(e) => set("onsiteReplace", e.target.checked)} data-testid="repair-onsite" />
          現場更換(不用送回)
        </label>
      </div>
      {!off && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" disabled={busy} onClick={() => void save()} className={buttonClass} data-testid="repair-save">儲存維修進度</button>
        </div>
      )}
      {message && (
        <div className={`mt-2 rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} role="alert" data-testid="repair-message">{message.text}</div>
      )}
    </section>
  );
}
