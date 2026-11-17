"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createIssueOption, deleteIssueOption, setIssueOptionActive, updateIssueOption } from "@/lib/actions/issueOptions";
import { ISSUE_OPTION_KINDS, type IssueOptionDto, type IssueOptionKind } from "@/lib/issueOptions";
import { actionErrorMessage } from "@/lib/userError";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { buttonClass, inputClass, primaryButtonClass } from "./issueUi";

type Draft = { id: string | null; name: string; shortName: string; defaultRegionId: string; customerTypeId: string };

/**
 * 選項管理(原 Sheet 的 _mgt 分頁):各個下拉選單的選項。只有管理者進得來,
 * 用過的選項只能停用不能刪;停用後新案件看不到,舊案件照常顯示。
 */
export function IssueOptionsManager({ options }: { options: IssueOptionDto[] }) {
  const router = useRouter();
  const { confirm } = useDialogs();
  const [kind, setKind] = useState<IssueOptionKind>("CUSTOMER");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const meta = ISSUE_OPTION_KINDS.find((k) => k.kind === kind)!;
  const list = options.filter((o) => o.kind === kind);
  const nameOf = (id: string | null) => options.find((o) => o.id === id)?.name ?? "";
  const regions = options.filter((o) => o.kind === "REGION" && o.active);
  const types = options.filter((o) => o.kind === "CUSTOMER_TYPE" && o.active);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "操作失敗"));
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const input = { kind, name: draft.name, shortName: draft.shortName, defaultRegionId: draft.defaultRegionId || null, customerTypeId: draft.customerTypeId || null };
      if (draft.id) await updateIssueOption(draft.id, input);
      else await createIssueOption(input);
      setDraft(null);
      router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "儲存失敗"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(o: IssueOptionDto) {
    if (!(await confirm(`確定要刪除「${o.name}」嗎?此操作無法復原。`, { title: "刪除選項", confirmLabel: "刪除", danger: true }))) return;
    await run(() => deleteIssueOption(o.id));
  }

  return (
    <div data-testid="options-manager">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ISSUE_OPTION_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => { setKind(k.kind); setError(null); }}
            className={`rounded-full border px-3 py-1 text-xs ${k.kind === kind ? "border-blue-600 bg-blue-600 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"}`}
            data-testid={`kind-${k.kind}`}
          >
            {k.label} <span className="opacity-70">({options.filter((o) => o.kind === k.kind).length})</span>
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        {meta.hint}<span className="ml-1 text-neutral-400">(原 Sheet:{meta.sheetColumn})</span>
      </p>

      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}

      <div className="mb-3">
        <button type="button" onClick={() => setDraft({ id: null, name: "", shortName: "", defaultRegionId: "", customerTypeId: "" })} className={`${primaryButtonClass} flex items-center gap-1.5`} data-testid="add-option">
          <Plus size={14} /> 新增{meta.label}
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-xs font-medium text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              <th className="px-3 py-2">名稱</th>
              {kind === "PART" && <th className="px-3 py-2">簡稱</th>}
              {kind === "CUSTOMER" && <th className="px-3 py-2">預設地區</th>}
              {kind === "CUSTOMER" && <th className="px-3 py-2">客戶型態</th>}
              <th className="px-3 py-2 text-right">使用處</th>
              <th className="px-3 py-2">狀態</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id} className={`border-b border-neutral-100 dark:border-neutral-800 ${o.active ? "" : "opacity-50"}`} data-testid="option-row">
                <td className="px-3 py-1.5">{o.name}</td>
                {kind === "PART" && <td className="px-3 py-1.5 text-neutral-500">{o.shortName ?? "—"}</td>}
                {kind === "CUSTOMER" && <td className="px-3 py-1.5 text-neutral-500">{nameOf(o.defaultRegionId) || "—"}</td>}
                {kind === "CUSTOMER" && <td className="px-3 py-1.5 text-neutral-500">{nameOf(o.customerTypeId) || "—"}</td>}
                <td className="px-3 py-1.5 text-right tabular-nums text-neutral-500">{o.usage}</td>
                <td className="px-3 py-1.5">
                  <button type="button" onClick={() => void run(() => setIssueOptionActive(o.id, !o.active))} className="text-xs text-blue-600 hover:underline" data-testid="toggle-active">
                    {o.active ? "啟用中(點此停用)" : "已停用(點此啟用)"}
                  </button>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  <button type="button" onClick={() => setDraft({ id: o.id, name: o.name, shortName: o.shortName ?? "", defaultRegionId: o.defaultRegionId ?? "", customerTypeId: o.customerTypeId ?? "" })} title="編輯" className="mr-2 text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-100" data-testid="edit-option">
                    <Pencil size={14} />
                  </button>
                  <button type="button" onClick={() => void remove(o)} title={o.usage > 0 ? "已被使用,只能停用" : "刪除"} disabled={o.usage > 0} className="text-neutral-400 hover:text-red-600 disabled:opacity-30" data-testid="delete-option">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-neutral-400">這個類別還沒有選項。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={draft !== null} onOpenChange={(o) => { if (!o) setDraft(null); }} title={draft?.id ? `編輯${meta.label}` : `新增${meta.label}`}>
        {draft && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              名稱
              <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${inputClass} mt-1`} data-testid="option-name" />
            </label>
            {kind === "PART" && (
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                簡稱(統整頁用來歸類,例如 M2 WHEEL HUB)
                <input value={draft.shortName} onChange={(e) => setDraft({ ...draft, shortName: e.target.value })} className={`${inputClass} mt-1`} />
              </label>
            )}
            {kind === "CUSTOMER" && (
              <>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  預設地區
                  <select value={draft.defaultRegionId} onChange={(e) => setDraft({ ...draft, defaultRegionId: e.target.value })} className={`${inputClass} mt-1`}>
                    <option value="">未設定</option>
                    {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  客戶型態
                  <select value={draft.customerTypeId} onChange={(e) => setDraft({ ...draft, customerTypeId: e.target.value })} className={`${inputClass} mt-1`}>
                    <option value="">未設定</option>
                    {types.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
              </>
            )}
            {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)} className={buttonClass}>取消</button>
              <button type="button" onClick={save} disabled={saving || !draft.name.trim()} className={primaryButtonClass} data-testid="option-save">{saving ? "儲存中..." : "儲存"}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
