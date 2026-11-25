"use client";

import { useState, useTransition } from "react";
import { setIssueFlowEmail, setIssueStuckDays, setRegionFaes, type RegionFaeRow } from "@/lib/actions/issueFlow";
import { actionErrorMessage } from "@/lib/userError";

const inputCls = "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

/** ISSUE TRACKER 客服維修流程的設定:卡關提醒的天數、流程通知要不要寄 email、每個地區由哪些 FAE 負責。 */
export function IssueFlowSettingsCard({
  stuckDays,
  flowEmail,
  regions,
  faes,
}: {
  stuckDays: number;
  flowEmail: boolean;
  regions: RegionFaeRow[];
  faes: { id: string; name: string }[];
}) {
  const [days, setDays] = useState(String(stuckDays));
  const [email, setEmail] = useState(flowEmail);
  const [byRegion, setByRegion] = useState<Record<string, string[]>>(() => Object.fromEntries(regions.map((r) => [r.regionId, r.userIds])));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(fn: () => Promise<void>, okText: string, rollback?: () => void) {
    setMessage(null);
    startTransition(async () => {
      try {
        await fn();
        setMessage({ ok: true, text: okText });
      } catch (err) {
        rollback?.();
        setMessage({ ok: false, text: actionErrorMessage(err, "儲存失敗") });
      }
    });
  }

  return (
    <div className="max-w-3xl rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900" data-testid="issue-flow-settings" data-issue-flow-card>
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">客服維修流程</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        案件依 Sales → FAE → RD 的流程走。誰是 Sales / FAE / RD 在「使用者管理」設定(每個人的「客服維修流程角色」);輪到某個階段時會通知那個角色的人。
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
        <label htmlFor="issue-stuck-days">同一個階段超過</label>
        <input id="issue-stuck-days" type="number" min={0} max={60} value={days} disabled={isPending} onChange={(e) => setDays(e.target.value)} className={`${inputCls} w-20`} data-testid="issue-stuck-days" />
        <span>個工作天沒有進展,就提醒負責的人與管理者(0 = 不提醒)</span>
        <button type="button" disabled={isPending} onClick={() => run(() => setIssueStuckDays(Number(days)), "已儲存卡關提醒天數")} className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800" data-testid="issue-stuck-save">
          儲存
        </button>
      </div>

      <label className="mb-4 flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-200">
        <input
          type="checkbox"
          checked={email}
          disabled={isPending}
          data-testid="issue-flow-email"
          onChange={(e) => {
            const prev = email;
            const next = e.target.checked;
            setEmail(next);
            run(() => setIssueFlowEmail(next), next ? "流程通知也會寄 email" : "流程通知只發站內通知", () => setEmail(prev));
          }}
          className="mt-0.5"
        />
        <span>
          流程通知(案件輪到你、RD 回應、維修完成、卡關提醒…)除了站內通知也寄 email
          <span className="block text-xs text-neutral-400 dark:text-neutral-500">需要伺服器已設定 SMTP;每個人也可以在自己的通知偏好關掉。</span>
        </span>
      </label>

      <p className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">各地區負責的 FAE</p>
      <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">新案件通報時,案件的地區有指定 FAE 就只通知他們;沒指定的地區通知全部 FAE。</p>
      {faes.length === 0 ? (
        <p className="text-xs text-amber-600" data-testid="no-faes">還沒有人被設成「FAE」流程角色,先到「使用者管理」指定。</p>
      ) : regions.length === 0 ? (
        <p className="text-xs text-neutral-400">還沒有地區選項(到「選項管理」新增)。</p>
      ) : (
        <table className="text-xs" data-testid="region-fae-table">
          <tbody>
            {regions.map((r) => (
              <tr key={r.regionId} className="align-top">
                <td className="py-1 pr-3 font-medium text-neutral-700 dark:text-neutral-200">{r.regionName}</td>
                <td className="py-1 pr-3">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {faes.map((f) => (
                      <label key={f.id} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          disabled={isPending}
                          checked={(byRegion[r.regionId] ?? []).includes(f.id)}
                          onChange={(e) => setByRegion((cur) => ({ ...cur, [r.regionId]: e.target.checked ? [...(cur[r.regionId] ?? []), f.id] : (cur[r.regionId] ?? []).filter((x) => x !== f.id) }))}
                          data-testid={`region-${r.regionName}-${f.name}`}
                        />
                        {f.name}
                      </label>
                    ))}
                  </div>
                </td>
                <td className="py-1">
                  <button type="button" disabled={isPending} onClick={() => run(() => setRegionFaes(r.regionId, byRegion[r.regionId] ?? []), `已儲存「${r.regionName}」的 FAE`)} className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50 dark:border-neutral-600 dark:hover:bg-neutral-800" data-testid={`region-save-${r.regionName}`}>
                    儲存
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {message && (
        <div className={`mt-3 rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} role="alert" data-testid="issue-flow-message">
          {message.text}
        </div>
      )}
    </div>
  );
}
