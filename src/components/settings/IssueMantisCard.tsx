"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteIssueMantisConnection,
  getIssueMantisMapping,
  loadIssueMantisCategories,
  loadIssueMantisEnums,
  loadIssueMantisProjects,
  saveIssueMantisConnection,
  saveIssueMantisMapping,
  setIssueMantisEnabled,
  syncIssueMantisNow,
  type IssueMantisConnectionRow,
} from "@/lib/actions/issueMantis";
import { ISSUE_WRITE_FIELDS, ISSUE_WRITE_FIELD_LABELS, priorityFromMantis, statusFromMantis, type CasePriority, type CaseStatus, type IssueMantisMapping } from "@/lib/issueMantis";
import { ISSUE_PRIORITY_LABELS, ISSUE_STATUS_LABELS } from "@/lib/issueCase";
import type { MantisProject, MantisUser } from "@/lib/mantis";
import type { MantisEnumEntry, MantisEnums, MantisRef } from "@/lib/mantisMapping";
import { useDialogs } from "@/components/ui/DialogProvider";
import { actionErrorMessage } from "@/lib/userError";

const input = "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";
const btn = "rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800";
const primary = "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";
const enumName = (e: MantisEnumEntry) => (e.label && e.label !== e.name ? `${e.label}(${e.name})` : e.name);
const refOf = (list: MantisEnumEntry[], id: number): MantisRef | null => {
  const e = list.find((x) => x.id === id);
  return e ? { id: e.id, name: e.name } : null;
};

/**
 * ISSUE TRACKER 的 Mantis 連線:網址、token、專案、啟用、立即同步,以及「欄位對應與寫回」。
 * 系統管理員專用。token 不會從伺服器傳回來,留白 = 沿用已經存著的。
 */
export function IssueMantisCard({ initial }: { initial: IssueMantisConnectionRow | null }) {
  const router = useRouter();
  const { confirm } = useDialogs();
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<MantisProject[]>(initial ? [{ id: initial.projectId, name: initial.projectName }] : []);
  const [projectId, setProjectId] = useState(initial?.projectId ?? 0);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ ok: false, text: actionErrorMessage(err, "操作失敗") });
    } finally {
      setBusy(false);
    }
  }

  const syncText = (r: { ok: true; summary: { total: number; created: number; updated: number; unchanged: number; note?: string } } | { ok: false; error: string } | undefined) =>
    !r ? "已儲存" : r.ok ? `已儲存並同步:共 ${r.summary.total} 筆,新增 ${r.summary.created}、更新 ${r.summary.updated}、沒變 ${r.summary.unchanged}${r.summary.note ? `。${r.summary.note}` : ""}` : `已儲存,但同步失敗:${r.error}`;

  return (
    <div className="max-w-3xl rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900" data-testid="issue-mantis-card" data-issue-mantis-card>
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">Mantis 連線</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        把 ISSUE TRACKER 的案件跟一個 MantisBT 專案連起來:Mantis 的單同步成案件(每 15 分鐘與「立即同步」),案件可以建立到 Mantis,已連結的案件依下面的「寫回」設定把修改寫回 Mantis。
        API token 加密存放、不會顯示;<b>留白 = 沿用已存著的</b>。建議用 ISSUE TRACKER 專用的 Mantis 專案。
      </p>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="block text-xs text-neutral-500">
          Mantis 網址
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://mantis.example.com" className={`${input} mt-1 w-full`} data-testid="mantis-base-url" />
        </label>
        <label className="block text-xs text-neutral-500">
          API token{initial ? "(留白沿用)" : ""}
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className={`${input} mt-1 w-full`} data-testid="mantis-token" />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          className={btn}
          data-testid="mantis-load-projects"
          onClick={() =>
            guard(async () => {
              const r = await loadIssueMantisProjects({ baseUrl, token });
              if ("error" in r) {
                setMessage({ ok: false, text: r.error });
                return;
              }
              setBaseUrl(r.baseUrl);
              setProjects(r.projects);
              if (!r.projects.some((p) => p.id === projectId)) setProjectId(r.projects[0].id);
              setMessage({ ok: true, text: `讀到 ${r.projects.length} 個 Mantis 專案,請選一個。` });
            })
          }
        >
          讀取 Mantis 專案
        </button>
        <select value={projectId || ""} onChange={(e) => setProjectId(Number(e.target.value))} className={input} aria-label="Mantis 專案" data-testid="mantis-project">
          <option value="">選擇專案</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-200">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 啟用同步
        </label>
        <button
          type="button"
          disabled={busy || !projectId || !baseUrl.trim()}
          className={primary}
          data-testid="mantis-save"
          onClick={() =>
            guard(async () => {
              const r = await saveIssueMantisConnection({ baseUrl, token, projectId, projectName: projects.find((p) => p.id === projectId)?.name ?? "", enabled });
              if (r.error) {
                setMessage({ ok: false, text: r.error });
                return;
              }
              setToken("");
              setMessage({ ok: !r.sync || r.sync.ok, text: syncText(r.sync) });
              router.refresh();
            })
          }
        >
          儲存並同步
        </button>
      </div>

      {initial && (
        <div className="mt-3 space-y-1 border-t border-neutral-100 pt-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300" data-testid="mantis-status">
          <p>
            目前連線:{initial.baseUrl} 專案「{initial.projectName}」{initial.enabled ? "" : "(停用中)"};已連到 Mantis 的案件 {initial.linkedCount} 件;寫回:
            {initial.writeBack.enabled ? `開啟(${initial.writeBack.fields.map((f) => ISSUE_WRITE_FIELD_LABELS[f]).join("、")})` : "關閉"}
          </p>
          <p>
            上次同步:{initial.lastSyncAt ? new Date(initial.lastSyncAt).toLocaleString("zh-TW") : "還沒有"}
            {initial.summary ? `(共 ${initial.summary.total} 筆,新增 ${initial.summary.created}、更新 ${initial.summary.updated}、沒變 ${initial.summary.unchanged}${initial.summary.truncated ? ",超過上限已截斷" : ""})` : ""}
          </p>
          {initial.lastSyncError && <p className="text-red-600">同步失敗:{initial.lastSyncError}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" disabled={busy} className={btn} data-testid="mantis-sync-now" onClick={() => guard(async () => { const r = await syncIssueMantisNow(); setMessage(r.error ? { ok: false, text: r.error } : { ok: true, text: `同步完成:共 ${r.summary!.total} 筆,新增 ${r.summary!.created}、更新 ${r.summary!.updated}、沒變 ${r.summary!.unchanged}` }); router.refresh(); })}>
              立即同步
            </button>
            <button type="button" disabled={busy} className={btn} onClick={() => guard(async () => { await setIssueMantisEnabled(!initial.enabled); router.refresh(); })}>
              {initial.enabled ? "停用同步" : "啟用同步"}
            </button>
            <button type="button" disabled={busy} className={btn} data-testid="mantis-map-toggle" onClick={() => setMapOpen((v) => !v)}>
              {mapOpen ? "收起欄位對應與寫回" : "欄位對應與寫回"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={`${btn} text-red-600`}
              onClick={() =>
                guard(async () => {
                  if (!(await confirm("確定要刪除這個 Mantis 連線嗎?已連結的案件會保留成一般案件(Mantis 連結清除),不再同步與寫回。", { title: "刪除 Mantis 連線", confirmLabel: "刪除", danger: true }))) return;
                  const r = await deleteIssueMantisConnection();
                  setMessage(r.error ? { ok: false, text: r.error } : { ok: true, text: "已刪除連線" });
                  router.refresh();
                })
              }
            >
              刪除連線
            </button>
          </div>
        </div>
      )}
      {message && (
        <div className={`mt-2 rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} role="alert" data-testid="mantis-card-message">
          {message.text}
        </div>
      )}
      {initial && mapOpen && <MappingEditor onSaved={() => router.refresh()} />}
    </div>
  );
}

function MappingEditor({ onSaved }: { onSaved: () => void }) {
  const [state, setState] = useState<
    | { loading: true }
    | { loading: false; error: string }
    | { loading: false; mapping: IssueMantisMapping; mantisUsers: MantisUser[]; localUsers: { id: string; name: string; email: string }[]; products: { id: string; name: string }[]; categories: string[]; note?: string }
  >({ loading: true });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [m, e, c] = await Promise.all([getIssueMantisMapping(), loadIssueMantisEnums(), loadIssueMantisCategories()]);
      if (cancelled) return;
      if ("error" in m) return setState({ loading: false, error: m.error });
      const enums: MantisEnums = "error" in e ? m.mapping.enums : e.enums;
      setState({
        loading: false,
        mapping: { ...m.mapping, enums },
        mantisUsers: m.mantisUsers,
        localUsers: m.localUsers,
        products: m.products,
        categories: c.categories,
        note: [("error" in e ? e.error : e.note), c.note].filter(Boolean).join(" "),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) return <p className="mt-3 text-xs text-neutral-400">讀取設定中…</p>;
  if ("error" in state) return <p className="mt-3 text-xs text-red-600">{state.error}</p>;
  const { mapping, mantisUsers, localUsers, products, categories } = state;
  const patch = (next: Partial<IssueMantisMapping>) => setState({ ...state, mapping: { ...mapping, ...next } });
  const e = mapping.enums;
  const statuses: CaseStatus[] = ["OPEN", "TC", "PC", "NA"];
  const priorities: CasePriority[] = ["P0", "P1", "P2", "P3"];
  const th = "py-1 pr-3 text-left text-[11px] font-normal text-neutral-400";

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await saveIssueMantisMapping(mapping);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.sync ? (r.sync.ok ? "已儲存並重新同步" : `已儲存,但同步失敗:${r.sync.error}`) : "已儲存" });
      if (!r.error) onSaved();
    } catch (err) {
      setMsg({ ok: false, text: actionErrorMessage(err, "儲存失敗") });
    } finally {
      setSaving(false);
    }
  }

  const refSelect = (list: MantisEnumEntry[], value: MantisRef | undefined | null, onChange: (r: MantisRef | null) => void, empty = "不寫回") => (
    <select value={value?.id ?? ""} onChange={(ev) => onChange(ev.target.value ? refOf(list, Number(ev.target.value)) : null)} className={input}>
      <option value="">{empty}</option>
      {list.map((x) => (
        <option key={x.id} value={x.id}>{enumName(x)}</option>
      ))}
    </select>
  );

  return (
    <div className="mt-3 space-y-5 border-t border-neutral-100 pt-3 dark:border-neutral-800" data-testid="mantis-mapping">
      {state.note && <p className="text-xs text-amber-600">{state.note}</p>}

      <section>
        <h3 className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">寫回 Mantis</h3>
        <label className="mb-1 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mapping.writeBack.enabled} onChange={(ev) => patch({ writeBack: { ...mapping.writeBack, enabled: ev.target.checked } })} data-testid="mantis-writeback" />
          已連結的案件存檔時,把修改寫回 Mantis(預設關閉)
        </label>
        <div className="flex flex-wrap gap-3 text-xs">
          {ISSUE_WRITE_FIELDS.map((f) => (
            <label key={f} className="flex items-center gap-1">
              <input
                type="checkbox"
                disabled={!mapping.writeBack.enabled}
                checked={mapping.writeBack.fields.includes(f)}
                onChange={(ev) => patch({ writeBack: { ...mapping.writeBack, fields: ev.target.checked ? [...mapping.writeBack.fields, f] : mapping.writeBack.fields.filter((x) => x !== f) } })}
              />
              {ISSUE_WRITE_FIELD_LABELS[f]}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">Mantis 狀態 → 案件狀態</h3>
        <table className="text-xs">
          <thead><tr><th className={th}>Mantis 狀態</th><th className={th}>對應成</th></tr></thead>
          <tbody>
            {e.status.map((s) => (
              <tr key={s.id}>
                <td className="py-0.5 pr-3">{enumName(s)}</td>
                <td>
                  <select
                    value={mapping.statusIn[String(s.id)] ?? ""}
                    onChange={(ev) => {
                      const next = { ...mapping.statusIn };
                      if (ev.target.value) next[String(s.id)] = ev.target.value as CaseStatus;
                      else delete next[String(s.id)];
                      patch({ statusIn: next });
                    }}
                    className={input}
                  >
                    <option value="">預設({ISSUE_STATUS_LABELS[statusFromMantis({ ...mapping, statusIn: {} }, s.id)]})</option>
                    {statuses.map((st) => (
                      <option key={st} value={st}>{ISSUE_STATUS_LABELS[st]}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">案件狀態 → 寫回 Mantis 的狀態</h3>
        <table className="text-xs">
          <tbody>
            {statuses.map((st) => (
              <tr key={st}>
                <td className="py-0.5 pr-3">{ISSUE_STATUS_LABELS[st]}</td>
                <td>{refSelect(e.status, mapping.statusOut[st], (r) => { const next = { ...mapping.statusOut }; if (r) next[st] = r; else delete next[st]; patch({ statusOut: next }); })}</td>
              </tr>
            ))}
            <tr>
              <td className="py-0.5 pr-3">結案時帶的 resolution</td>
              <td>{refSelect(e.resolution, mapping.resolutionOut, (r) => patch({ resolutionOut: r }), "不帶")}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">Mantis 嚴重度 ↔ 優先級</h3>
        <div className="flex flex-wrap gap-8">
          <table className="text-xs">
            <thead><tr><th className={th}>Mantis 嚴重度</th><th className={th}>對應成</th></tr></thead>
            <tbody>
              {e.severity.map((s) => (
                <tr key={s.id}>
                  <td className="py-0.5 pr-3">{enumName(s)}</td>
                  <td>
                    <select
                      value={mapping.priorityIn[String(s.id)] ?? ""}
                      onChange={(ev) => {
                        const next = { ...mapping.priorityIn };
                        if (ev.target.value) next[String(s.id)] = ev.target.value as CasePriority;
                        else delete next[String(s.id)];
                        patch({ priorityIn: next });
                      }}
                      className={input}
                    >
                      <option value="">預設({priorityFromMantis({ ...mapping, priorityIn: {} }, s.id)})</option>
                      {priorities.map((p) => (
                        <option key={p} value={p}>{ISSUE_PRIORITY_LABELS[p]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="text-xs">
            <thead><tr><th className={th}>優先級</th><th className={th}>寫回的 Mantis 嚴重度</th></tr></thead>
            <tbody>
              {priorities.map((p) => (
                <tr key={p}>
                  <td className="py-0.5 pr-3">{ISSUE_PRIORITY_LABELS[p]}</td>
                  <td>{refSelect(e.severity, mapping.priorityOut[p], (r) => { const next = { ...mapping.priorityOut }; if (r) next[p] = r; else delete next[p]; patch({ priorityOut: next }); })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">建立到 Mantis 的分類(Mantis 必填)</h3>
        <div className="mb-2 flex items-center gap-2 text-xs">
          預設分類
          <input list="mantis-categories" value={mapping.categoryDefault ?? ""} onChange={(ev) => patch({ categoryDefault: ev.target.value || null })} placeholder="分類名稱" className={input} data-testid="mantis-category-default" />
          <datalist id="mantis-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        {products.length > 0 && (
          <table className="text-xs">
            <thead><tr><th className={th}>產品型號</th><th className={th}>分類(留白用預設)</th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="py-0.5 pr-3">{p.name}</td>
                  <td>
                    <input
                      list="mantis-categories"
                      value={mapping.categoryByProduct[p.id] ?? ""}
                      onChange={(ev) => { const next = { ...mapping.categoryByProduct }; if (ev.target.value) next[p.id] = ev.target.value; else delete next[p.id]; patch({ categoryByProduct: next }); }}
                      className={input}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">負責人對應(Email 與名稱對不上時手動指定)</h3>
        <table className="text-xs">
          <thead><tr><th className={th}>本系統使用者</th><th className={th}>Mantis 使用者</th></tr></thead>
          <tbody>
            {localUsers.map((u) => (
              <tr key={u.id}>
                <td className="py-0.5 pr-3">{u.name}({u.email})</td>
                <td>
                  <select
                    value={mapping.handlerOverrides[u.id] ?? ""}
                    onChange={(ev) => { const next = { ...mapping.handlerOverrides }; if (ev.target.value) next[u.id] = Number(ev.target.value); else delete next[u.id]; patch({ handlerOverrides: next }); }}
                    className={input}
                  >
                    <option value="">自動比對(Email、名稱)</option>
                    {mantisUsers.map((m) => (
                      <option key={m.id} value={m.id}>{m.realName || m.name}{m.email ? `(${m.email})` : ""}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {mantisUsers.length === 0 && <p className="mt-1 text-[11px] text-neutral-400">還沒有收集到 Mantis 使用者(同步一次、讓問題單帶出處理人之後才有)。</p>}
      </section>

      {msg && <div className={`rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} role="alert" data-testid="mantis-map-message">{msg.text}</div>}
      <button type="button" disabled={saving} onClick={save} className={primary} data-testid="mantis-map-save">{saving ? "儲存中..." : "儲存對應與寫回設定"}</button>
    </div>
  );
}
