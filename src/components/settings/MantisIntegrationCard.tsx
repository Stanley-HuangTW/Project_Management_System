"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  deleteMantisConnection,
  listMantisConnections,
  loadMantisProjects,
  saveMantisConnection,
  setMantisEnabled,
  syncMantisNow,
  type MantisConnectionRow,
} from "@/lib/actions/mantis";
import type { MantisProject } from "@/lib/mantis";
import { WRITE_FIELD_LABELS } from "@/lib/mantisMapping";
import { MantisMappingEditor } from "./MantisMappingEditor";
import type { SyncSummary } from "@/lib/mantisSync";
import { actionErrorMessage } from "@/lib/userError";

const inputClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

type Draft = {
  /** 編輯既有的連線(看板不能換、token 留白就沿用)。 */
  editing: boolean;
  boardId: string;
  baseUrl: string;
  token: string;
  projectId: number | null;
  projectName: string;
  enabled: boolean;
};

function describeSummary(s: SyncSummary): string {
  return `共 ${s.total} 筆:新增 ${s.created}、更新 ${s.updated}、沒變 ${s.unchanged}${s.truncated ? "(超過上限,只抓了前 5000 筆)" : ""}${s.note ? `。${s.note}` : ""}`;
}

/**
 * 看板與 MantisBT 專案的連線。單向:Mantis 的問題同步成這個看板「風險與議題」裡的問題,
 * 掛在看板上一個叫「ISSUE」的工作項底下;一個看板對一個 Mantis 專案。
 */
export function MantisIntegrationCard() {
  const { notify, confirm } = useDialogs();
  const [data, setData] = useState<{ connections: MantisConnectionRow[]; boards: { id: string; name: string }[] } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [projects, setProjects] = useState<MantisProject[]>([]);
  const [busy, setBusy] = useState(false);
  const [mappingFor, setMappingFor] = useState<{ boardId: string; boardName: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listMantisConnections();
      if (!cancelled) setData(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const reload = () => setRefreshKey((k) => k + 1);

  async function guard<T>(work: () => Promise<T>, failTitle: string): Promise<T | null> {
    setBusy(true);
    try {
      return await work();
    } catch (err) {
      await notify(actionErrorMessage(err, "操作失敗"), { title: failTitle });
      return null;
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    const first = data?.boards[0];
    if (!first) return;
    setProjects([]);
    setDraft({ editing: false, boardId: first.id, baseUrl: "", token: "", projectId: null, projectName: "", enabled: true });
  }

  function startEdit(c: MantisConnectionRow) {
    setProjects([{ id: c.projectId, name: c.projectName }]);
    setDraft({ editing: true, boardId: c.boardId, baseUrl: c.baseUrl, token: "", projectId: c.projectId, projectName: c.projectName, enabled: c.enabled });
  }

  async function loadProjects() {
    if (!draft) return;
    const result = await guard(
      () => loadMantisProjects({ baseUrl: draft.baseUrl, token: draft.token, boardId: draft.editing ? draft.boardId : null }),
      "無法讀取 Mantis 專案"
    );
    if (!result) return;
    if ("error" in result) {
      await notify(result.error, { title: "無法讀取 Mantis 專案" });
      return;
    }
    setProjects(result.projects);
    const keep = result.projects.find((p) => p.id === draft.projectId);
    setDraft({
      ...draft,
      baseUrl: result.baseUrl,
      projectId: keep?.id ?? result.projects[0].id,
      projectName: keep?.name ?? result.projects[0].name,
    });
  }

  async function save() {
    if (!draft || draft.projectId === null) return;
    const result = await guard(
      () =>
        saveMantisConnection({
          boardId: draft.boardId,
          baseUrl: draft.baseUrl,
          token: draft.token,
          projectId: draft.projectId!,
          projectName: draft.projectName,
          enabled: draft.enabled,
        }),
      "無法儲存"
    );
    if (!result) return;
    if (result.error) {
      await notify(result.error, { title: "無法儲存" });
      return;
    }
    setDraft(null);
    reload();
    if (result.sync) {
      await notify(
        result.sync.ok ? `已儲存並同步。${describeSummary(result.sync.summary)}` : `已儲存,但第一次同步失敗:${result.sync.error}`,
        { title: "Mantis 連線" }
      );
    }
  }

  async function syncNow(c: MantisConnectionRow) {
    const result = await guard(() => syncMantisNow(c.boardId), "同步失敗");
    if (!result) return;
    reload();
    await notify(result.error ?? `同步完成。${describeSummary(result.summary!)}`, { title: result.error ? "同步失敗" : "Mantis 同步" });
  }

  async function toggle(c: MantisConnectionRow, enabled: boolean) {
    const result = await guard(() => setMantisEnabled(c.boardId, enabled), "無法變更");
    if (result?.error) await notify(result.error, { title: "無法變更" });
    reload();
  }

  async function remove(c: MantisConnectionRow) {
    const ok = await confirm(
      `刪除看板「${c.boardName}」與 Mantis 的連線?已經同步下來的 ${c.issueCount} 筆問題會保留,但變成一般問題:不再同步,也可以自己修改。`,
      { title: "刪除連線", confirmLabel: "刪除", danger: true }
    );
    if (!ok) return;
    const result = await guard(() => deleteMantisConnection(c.boardId), "無法刪除");
    if (result?.error) await notify(result.error, { title: "無法刪除" });
    reload();
  }

  const boardOptions = draft?.editing ? (data?.connections ?? []).filter((c) => c.boardId === draft.boardId).map((c) => ({ id: c.boardId, name: c.boardName })) : (data?.boards ?? []);

  return (
    <div className="max-w-3xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">MantisBT 同步</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        把 MantisBT 專案的問題同步進看板的「風險與議題」。一個看板對一個 Mantis 專案;同步下來的問題都掛在看板上一個叫「ISSUE」的工作項底下。
        預設只從 Mantis 讀、問題在這裡是唯讀的;在「欄位對應與寫回」可以設定 Mantis 與本系統欄位的對應,並選擇開啟寫回(在這邊改了就寫進 Mantis)。
        每 15 分鐘自動同步一次,也可以按「立即同步」。需要 Mantis 2.20 以上、在 Mantis 的「我的帳號 → API 權杖」建一個 token(那個帳號要能檢視該專案)。
      </p>

      {data === null ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : (
        <div className="space-y-3">
          {data.connections.length === 0 && !draft && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">還沒有任何連線。</p>
          )}

          {data.connections.map((c) => (
            <div key={c.boardId} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{c.boardName}</span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">↔ Mantis 專案「{c.projectName}」</span>
                <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  <input type="checkbox" checked={c.enabled} disabled={busy} onChange={(e) => toggle(c, e.target.checked)} />
                  啟用
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => syncNow(c)}
                  className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  <RefreshCw size={12} /> 立即同步
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => startEdit(c)}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  編輯
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMappingFor({ boardId: c.boardId, boardName: c.boardName })}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  欄位對應與寫回
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(c)}
                  className="rounded p-1 text-neutral-400 hover:text-red-600 disabled:opacity-50 dark:text-neutral-500"
                  aria-label={`刪除 ${c.boardName} 的 Mantis 連線`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="mt-1 break-all text-xs text-neutral-400 dark:text-neutral-500">{c.baseUrl}</p>
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
                問題 {c.issueCount} 筆(未結案 {c.openCount} 筆)
                {c.lastSyncAt && <>・上次同步 {new Date(c.lastSyncAt).toLocaleString("zh-TW")}</>}
                {!c.enabled && "・已停用"}
              </p>
              {c.writeBack.enabled && (
                <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  已開啟寫回 Mantis:{c.writeBack.fields.map((f) => WRITE_FIELD_LABELS[f]).join("、")}
                </p>
              )}
              {c.lastSyncError ? (
                <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
                  上次同步失敗:{c.lastSyncError}
                </p>
              ) : (
                c.summary && <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{describeSummary(c.summary)}</p>
              )}
            </div>
          ))}

          {draft && (
            <div className="space-y-3 rounded-md bg-neutral-50 p-3 dark:bg-neutral-800/60">
              <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{draft.editing ? "編輯連線" : "新增連線"}</p>
              <label className="block text-xs text-neutral-500 dark:text-neutral-400">
                看板
                <select
                  value={draft.boardId}
                  disabled={draft.editing}
                  onChange={(e) => setDraft({ ...draft, boardId: e.target.value })}
                  className={`${inputClass} mt-1 block w-full`}
                >
                  {boardOptions.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-neutral-500 dark:text-neutral-400">
                Mantis 網址
                <input
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder="https://mantis.example.com"
                  className={`${inputClass} mt-1 block w-full`}
                />
              </label>
              <label className="block text-xs text-neutral-500 dark:text-neutral-400">
                API token
                <input
                  type="password"
                  autoComplete="off"
                  value={draft.token}
                  onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                  placeholder={draft.editing ? "已儲存,不想換就留白" : "貼上 Mantis 的 API 權杖"}
                  className={`${inputClass} mt-1 block w-full`}
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[14rem] flex-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Mantis 專案
                  <select
                    value={draft.projectId ?? ""}
                    disabled={projects.length === 0}
                    onChange={(e) => {
                      const p = projects.find((x) => x.id === Number(e.target.value));
                      if (p) setDraft({ ...draft, projectId: p.id, projectName: p.name });
                    }}
                    className={`${inputClass} mt-1 block w-full`}
                  >
                    {projects.length === 0 && <option value="">先按「讀取專案」</option>}
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}(#{p.id})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy || !draft.baseUrl.trim() || (!draft.token.trim() && !draft.editing)}
                  onClick={loadProjects}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-white disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  讀取專案
                </button>
              </div>
              <label className="flex w-fit items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                啟用(定時同步)
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || draft.projectId === null}
                  onClick={save}
                  className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? "處理中..." : "儲存並同步"}
                </button>
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm text-neutral-600 hover:bg-white dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {!draft && (
            <button
              type="button"
              disabled={data.boards.length === 0}
              onClick={startNew}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
              title={data.boards.length === 0 ? "所有看板都已經有連線了" : undefined}
            >
              新增連線
            </button>
          )}
        </div>
      )}
      {mappingFor && (
        <MantisMappingEditor
          key={mappingFor.boardId}
          boardId={mappingFor.boardId}
          boardName={mappingFor.boardName}
          open
          onOpenChange={(open) => {
            if (!open) setMappingFor(null);
          }}
          onSaved={reload}
        />
      )}
    </div>
  );
}
