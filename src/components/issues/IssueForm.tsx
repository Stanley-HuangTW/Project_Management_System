"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { createIssueCase, updateIssueCase } from "@/lib/actions/issueCases";
import { ISSUE_KIND_LABELS, ISSUE_PRIORITY_LABELS, ISSUE_STATUS_LABELS } from "@/lib/issueCase";
import { partLabel, type IssueOptionDto } from "@/lib/issueOptions";
import type { IssueCaseInput, IssueUserDto } from "@/lib/issueTypes";
import { actionErrorMessage } from "@/lib/userError";
import { useDialogs } from "@/components/ui/DialogProvider";
import { inputClass, primaryButtonClass } from "./issueUi";

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-neutral-400">{hint}</span>}
    </label>
  );
}

/**
 * 新增與編輯共用的案件表單,分「回報內容」與「處理內容」兩段:各自依權限鎖定(回報人只能填前一段)。
 * 伺服器會再檢查一次權限,這裡的 disabled 只是讓畫面誠實。
 */
export function IssueForm({
  mode,
  caseId,
  initial,
  options,
  users,
  canEditReport,
  canEditHandling,
  canAssign,
  locked,
  mantisLock,
  mantisCreatable,
}: {
  mode: "create" | "edit";
  caseId?: string;
  initial: IssueCaseInput;
  options: IssueOptionDto[];
  users: IssueUserDto[];
  canEditReport: boolean;
  canEditHandling: boolean;
  canAssign: boolean;
  locked?: boolean;
  /** 案件已連到 Mantis 且連線啟用:沒開寫回的那一類欄位不能在這裡改,請到 Mantis 改。 */
  mantisLock?: { status: boolean; priority: boolean; content: boolean };
  /** 新增時顯示「同時建立到 Mantis」:Mantis 連線啟用,而且這個人是管理者或處理人。 */
  mantisCreatable?: boolean;
}) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [v, setV] = useState<IssueCaseInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof IssueCaseInput>(k: K, value: IssueCaseInput[K]) => {
    setSaved(false);
    setV((cur) => ({ ...cur, [k]: value }));
  };
  const opts = (kind: IssueOptionDto["kind"], selected: (string | null)[] = []) =>
    options.filter((o) => o.kind === kind && (o.active || selected.includes(o.id)));
  const select = (kind: IssueOptionDto["kind"], selected: string | null) =>
    opts(kind, [selected]).map((o) => ({ value: o.id, label: o.name, hint: kind === "CUSTOMER" ? undefined : undefined }));
  const multi = (kind: IssueOptionDto["kind"], selected: string[]) =>
    opts(kind, selected).map((o) => ({ id: o.id, name: kind === "PART" ? partLabel(o) : o.name }));
  const toggle = (key: "unitIds" | "partIds" | "assigneeIds", id: string) =>
    set(key, v[key].includes(id) ? v[key].filter((x) => x !== id) : [...v[key], id]);

  function pickCustomer(id: string) {
    set("customerId", id || null);
    // 新增時,客戶有預設地區就帶進來(已經手動選過地區的不蓋掉)。
    const c = options.find((o) => o.id === id);
    if (mode === "create" && c?.defaultRegionId && !v.regionId) setV((cur) => ({ ...cur, customerId: id, regionId: c.defaultRegionId }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const out = await createIssueCase(v);
        // Mantis 那邊沒建成功(案件已經建好):先讓使用者看到原因再進案件頁。
        if (out.mantisNote) await notify(out.mantisNote, { title: "建立到 Mantis" });
        router.push(`/issues/${out.id}`);
        return;
      }
      await updateIssueCase(caseId!, v);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "儲存失敗"));
    } finally {
      setSaving(false);
    }
  }

  const reportOff = !canEditReport;
  const handlingOff = !canEditHandling;
  const grid = "grid grid-cols-1 gap-3 md:grid-cols-2";
  const numberInput = (key: "deckCount" | "cutHours" | "wheelHours") => (
    <input
      type="number"
      min={0}
      step={key === "deckCount" ? 1 : 0.01}
      disabled={handlingOff}
      value={v[key] ?? ""}
      onChange={(e) => set(key, e.target.value === "" ? null : Number(e.target.value))}
      className={inputClass}
    />
  );

  return (
    <div className="space-y-4" data-testid="issue-form">
      <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">回報內容</h2>
        {reportOff && mode === "edit" && (
          <p className="mb-3 rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            {locked ? "案件已確認完成並鎖定,只有管理者可以修改。" : "你不能修改這個案件的回報內容。"}
          </p>
        )}
        <div className={grid}>
          <Field label="類型">
            <select disabled={reportOff} value={v.kind} onChange={(e) => set("kind", e.target.value as IssueCaseInput["kind"])} className={inputClass} data-testid="f-kind">
              {Object.entries(ISSUE_KIND_LABELS).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="優先級">
            <select disabled={reportOff || !!mantisLock?.priority} title={mantisLock?.priority ? "這個案件已連到 Mantis,優先級請到 Mantis 修改" : undefined} value={v.priority} onChange={(e) => set("priority", e.target.value as IssueCaseInput["priority"])} className={inputClass} data-testid="f-priority">
              {Object.entries(ISSUE_PRIORITY_LABELS).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="客戶 *">
            <SearchableSelect options={select("CUSTOMER", v.customerId)} value={v.customerId ?? ""} onChange={pickCustomer} disabled={reportOff} placeholder="選擇客戶" className={inputClass} />
          </Field>
          <Field label="產品型號 *">
            <SearchableSelect options={select("PRODUCT", v.productId)} value={v.productId ?? ""} onChange={(x) => set("productId", x || null)} disabled={reportOff} placeholder="選擇產品型號" className={inputClass} />
          </Field>
          <Field label="地區">
            <SearchableSelect options={select("REGION", v.regionId)} value={v.regionId ?? ""} onChange={(x) => set("regionId", x || null)} disabled={reportOff} placeholder="選擇地區" emptyLabel="未指定" className={inputClass} />
          </Field>
          <Field label="發生日期 *">
            <input type="date" disabled={reportOff} value={v.issueDate} onChange={(e) => set("issueDate", e.target.value)} className={inputClass} data-testid="f-issue-date" />
          </Field>
          <Field label={`QR code${v.kind === "REPAIR" ? " *(或序號)" : ""}`}>
            <input disabled={reportOff} value={v.qrCode} onChange={(e) => set("qrCode", e.target.value)} placeholder="例:M2-6419" className={inputClass} data-testid="f-qr" />
          </Field>
          <Field label="機器序號 (SN)">
            <input disabled={reportOff} value={v.serialNo} onChange={(e) => set("serialNo", e.target.value)} className={inputClass} />
          </Field>
          <Field label="保固狀態">
            <SearchableSelect options={select("WARRANTY", v.warrantyId)} value={v.warrantyId ?? ""} onChange={(x) => set("warrantyId", x || null)} disabled={reportOff} placeholder="選擇保固狀態" emptyLabel="未指定" className={inputClass} />
          </Field>
          <Field label={`問題描述${v.kind === "ISSUE" ? " *" : ""}`} wide>
            <textarea disabled={reportOff || !!mantisLock?.content} rows={4} value={v.description} onChange={(e) => set("description", e.target.value)} className={inputClass} data-testid="f-description" />
          </Field>
          <Field label="規格與行為(Specification and behavior)" wide>
            <textarea disabled={reportOff || !!mantisLock?.content} rows={3} value={v.behavior} onChange={(e) => set("behavior", e.target.value)} className={inputClass} />
          </Field>
        </div>
      </section>

      {(mode === "edit" || canEditHandling) && (
        <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">處理內容</h2>
          {handlingOff && (
            <p className="mb-3 rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              {locked ? "案件已確認完成並鎖定,只有管理者可以修改。" : "處理內容由負責的處理人或管理者填寫。"}
            </p>
          )}
          <div className={grid}>
            <Field label="負責人(可多人)" hint={canAssign ? undefined : "只有管理者可以指派;處理人可在案件頁「接手」沒人負責的案件。"}>
              <MultiSelect
                options={users.map((u) => ({ id: u.id, name: u.name }))}
                selectedIds={new Set(v.assigneeIds)}
                disabled={!canAssign}
                placeholder="待指派"
                onToggle={(id) => toggle("assigneeIds", id)}
              />
            </Field>
            <Field label="處理單位(可多個)">
              <MultiSelect options={multi("HANDLER_UNIT", v.unitIds)} selectedIds={new Set(v.unitIds)} disabled={handlingOff} placeholder="未指定" onToggle={(id) => toggle("unitIds", id)} />
            </Field>
            <Field label="問題類型(Error Type)">
              <SearchableSelect options={select("ERROR_TYPE", v.errorTypeId)} value={v.errorTypeId ?? ""} onChange={(x) => set("errorTypeId", x || null)} disabled={handlingOff} placeholder="尚未判定" emptyLabel="尚未判定" className={inputClass} />
            </Field>
            <Field label="狀態">
              <select disabled={handlingOff || !!mantisLock?.status} title={mantisLock?.status ? "這個案件已連到 Mantis,狀態請到 Mantis 修改" : undefined} value={v.status} onChange={(e) => set("status", e.target.value as IssueCaseInput["status"])} className={inputClass} data-testid="f-status">
                {Object.entries(ISSUE_STATUS_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>{k} {l}</option>
                ))}
              </select>
            </Field>
            <Field label="結案日期" hint="狀態改成暫時解決 / 永久解決時,沒填會自動帶今天。">
              <input type="date" disabled={handlingOff} value={v.closeDate ?? ""} onChange={(e) => set("closeDate", e.target.value || null)} className={inputClass} data-testid="f-close-date" />
            </Field>
            <Field label="維修單號">
              <input disabled={handlingOff} value={v.repairOrderNo} onChange={(e) => set("repairOrderNo", e.target.value)} className={inputClass} />
            </Field>
            <Field label="更換重要零件(可多個)" wide>
              <MultiSelect options={multi("PART", v.partIds)} selectedIds={new Set(v.partIds)} disabled={handlingOff} placeholder="沒有更換零件" summaryLimit={3} onToggle={(id) => toggle("partIds", id)} />
            </Field>
            <div className="flex items-center gap-4 md:col-span-2">
              <label className="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-200">
                <input type="checkbox" disabled={handlingOff} checked={v.rma} onChange={(e) => set("rma", e.target.checked)} /> RMA
              </label>
              <label className="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-200">
                <input type="checkbox" disabled={handlingOff} checked={v.rmaCuttingDisk} onChange={(e) => set("rmaCuttingDisk", e.target.checked)} /> RMA By Cutting Disk
              </label>
            </div>
            <Field label="刀盤升降次數(Deck up/down times)">{numberInput("deckCount")}</Field>
            <Field label="割草時數(Cut_hr)">{numberInput("cutHours")}</Field>
            <Field label="行走時數(whl_hr)">{numberInput("wheelHours")}</Field>
          </div>
        </section>
      )}

      {mantisLock && (mantisLock.status || mantisLock.priority || mantisLock.content) && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200" data-testid="mantis-lock-note">
          這個案件已連到 Mantis:{[mantisLock.status && "狀態", mantisLock.priority && "優先級", mantisLock.content && "問題描述與規格與行為"].filter(Boolean).join("、")}請到 Mantis 修改(系統管理員可以在 ISSUE TRACKER 設定開啟寫回)。
        </p>
      )}
      {mode === "create" && mantisCreatable && (
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
          <input type="checkbox" checked={!!v.createInMantis} onChange={(e) => set("createInMantis", e.target.checked)} data-testid="f-create-in-mantis" />
          同時建立到 Mantis
        </label>
      )}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-testid="form-error">{error}</div>}
      {(canEditReport || canEditHandling || canAssign) && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving} className={primaryButtonClass} data-testid="save-issue">
            {saving ? "儲存中..." : mode === "create" ? "送出回報" : "儲存"}
          </button>
          {saved && <span className="text-sm text-emerald-600" data-testid="saved-note">已儲存</span>}
        </div>
      )}
    </div>
  );
}
