"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { getMantisMapping, loadMantisEnums, saveMantisMapping } from "@/lib/actions/mantis";
import type { MantisUser } from "@/lib/mantis";
import { severityToImpact, statusToRisk } from "@/lib/mantis";
import {
  WRITE_FIELDS,
  WRITE_FIELD_LABELS,
  defaultMapping,
  effectiveSeverityRows,
  effectiveStatusRows,
  type MantisEnumEntry,
  type MantisMapping,
  type WriteField,
} from "@/lib/mantisMapping";
import { RISK_STATUS_LABELS } from "@/lib/riskRegister";
import { actionErrorMessage } from "@/lib/userError";
import type { RiskStatus } from "@prisma/client";

const selectClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50";
const th = "px-2 py-1 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400";

const enumText = (e: MantisEnumEntry) => (e.label && e.label !== e.name ? `${e.label}(${e.name})` : e.name) + ` #${e.id}`;
const READ_STATUSES: RiskStatus[] = ["OPEN", "MITIGATING", "CLOSED"];
const WRITE_STATUSES: RiskStatus[] = ["OPEN", "MITIGATING", "PENDING_REVIEW", "CLOSED"];

type Loaded = { mapping: MantisMapping; mantisUsers: MantisUser[]; localUsers: { id: string; name: string; email: string }[] };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
      <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{title}</h3>
      {hint && <p className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
      {children}
    </section>
  );
}

/**
 * 一個 Mantis 連線的「欄位對應與寫回」設定(管理者):
 * Mantis 的狀態 / 嚴重度怎麼對應成本系統的狀態 / 衝擊,反過來寫回時用哪一個,處理人怎麼對上,以及要不要寫回。
 */
export function MantisMappingEditor({
  boardId,
  boardName,
  open,
  onOpenChange,
  onSaved,
}: {
  boardId: string;
  boardName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { notify, confirm } = useDialogs();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<MantisMapping | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await getMantisMapping(boardId);
        if (cancelled) return;
        if ("error" in result) {
          await notify(result.error, { title: "無法讀取設定" });
          onOpenChange(false);
          return;
        }
        setLoaded(result);
        setMapping(result.mapping);
      } catch (err) {
        if (!cancelled) {
          await notify(actionErrorMessage(err, "讀取失敗"), { title: "無法讀取設定" });
          onOpenChange(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId, notify, onOpenChange]);

  if (!open) return null;
  const set = (patch: Partial<MantisMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));

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

  async function readEnums() {
    const result = await guard(() => loadMantisEnums(boardId), "無法讀取");
    if (!result) return;
    if ("error" in result) {
      await notify(result.error, { title: "無法讀取" });
      return;
    }
    set({ enums: result.enums });
    await notify(result.fromMantis ? "已從 Mantis 讀到最新的狀態、嚴重度、優先權與 resolution。" : (result.note ?? "讀不到。"), {
      title: "Mantis 列舉值",
    });
  }

  async function save() {
    if (!mapping) return;
    const result = await guard(() => saveMantisMapping(boardId, mapping), "無法儲存");
    if (!result) return;
    if (result.error) {
      await notify(result.error, { title: "無法儲存" });
      return;
    }
    onSaved();
    onOpenChange(false);
    if (result.sync) {
      await notify(result.sync.ok ? "已儲存,並用新的對應重新同步了一次。" : `已儲存,但重新同步失敗:${result.sync.error}`, { title: "欄位對應" });
    }
  }

  async function reset() {
    if (!mapping) return;
    if (!(await confirm("把這個連線的欄位對應與寫回設定還原成預設值?寫回會變成關閉。", { title: "還原預設", confirmLabel: "還原" }))) return;
    setMapping({ ...defaultMapping(), enums: mapping.enums });
  }

  const enums = mapping?.enums;
  const mantisOptions = (list: MantisEnumEntry[]) =>
    list.map((e) => (
      <option key={e.id} value={e.id}>
        {enumText(e)}
      </option>
    ));
  const pick = (list: MantisEnumEntry[], id: string) => {
    const found = list.find((e) => e.id === Number(id));
    return found ? { id: found.id, name: found.name } : null;
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`欄位對應與寫回:${boardName}`} size="xl">
      {!mapping || !loaded || !enums ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : (
        <div className="space-y-4">
          <Section
            title="寫回 Mantis"
            hint="預設關閉:這個程式只從 Mantis 讀。開啟後,同步來的問題可以在這邊修改,存檔時馬上寫回 Mantis;Mantis 拒絕(沒權限、狀態不能轉換)就整筆不存並說明原因。刪除永遠不會寫回。"
          >
            <label className="flex w-fit items-center gap-2 text-sm text-neutral-800 dark:text-neutral-100">
              <input
                type="checkbox"
                checked={mapping.writeBack.enabled}
                onChange={(e) => set({ writeBack: { ...mapping.writeBack, enabled: e.target.checked } })}
              />
              允許從這個程式寫回 Mantis
            </label>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
              {WRITE_FIELDS.map((f: WriteField) => (
                <label key={f} className="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-200">
                  <input
                    type="checkbox"
                    disabled={!mapping.writeBack.enabled}
                    checked={mapping.writeBack.fields.includes(f)}
                    onChange={(e) =>
                      set({
                        writeBack: {
                          ...mapping.writeBack,
                          fields: WRITE_FIELDS.filter((x) => (x === f ? e.target.checked : mapping.writeBack.fields.includes(x))),
                        },
                      })
                    }
                  />
                  {WRITE_FIELD_LABELS[f]}
                </label>
              ))}
            </div>
            <p className="pl-6 text-xs text-amber-700 dark:text-amber-300">
              寫回用的是這個連線存著的 API token,Mantis 上顯示的修改者就是那個 token 的帳號;那個帳號要有「更新問題」的權限。
            </p>
          </Section>

          <Section title="Mantis → 本系統:狀態" hint="Mantis 的每個狀態,在這邊算「未處理 / 處理中 / 已結案」哪一種。標「預設」的是沒設定過、照編號門檻(50 以上處理中、80 以上已結案)算的。">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Mantis 狀態</th>
                  <th className={th}>本系統狀態</th>
                </tr>
              </thead>
              <tbody>
                {effectiveStatusRows(mapping).map(({ entry, status, explicit }) => (
                  <tr key={entry.id}>
                    <td className="px-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-200">{enumText(entry)}</td>
                    <td className="px-2 py-0.5">
                      <select
                        value={status}
                        onChange={(e) => {
                          const next = { ...mapping.statusIn };
                          const value = e.target.value as RiskStatus;
                          if (value === statusToRisk(entry.id)) delete next[String(entry.id)];
                          else next[String(entry.id)] = value;
                          set({ statusIn: next });
                        }}
                        className={selectClass}
                      >
                        {READ_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {RISK_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      {!explicit && <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">預設</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Mantis → 本系統:嚴重度對應衝擊" hint="衝擊 1–5 決定風險分數(問題的機率固定是最高)。">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Mantis 嚴重度</th>
                  <th className={th}>衝擊</th>
                </tr>
              </thead>
              <tbody>
                {effectiveSeverityRows(mapping).map(({ entry, impact, explicit }) => (
                  <tr key={entry.id}>
                    <td className="px-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-200">{enumText(entry)}</td>
                    <td className="px-2 py-0.5">
                      <select
                        value={impact}
                        onChange={(e) => {
                          const next = { ...mapping.severityIn };
                          const value = Number(e.target.value);
                          if (value === severityToImpact(entry.id)) delete next[String(entry.id)];
                          else next[String(entry.id)] = value;
                          set({ severityIn: next });
                        }}
                        className={selectClass}
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      {!explicit && <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">預設</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="本系統 → Mantis:寫回的狀態" hint="在這邊改成哪個狀態時,Mantis 要改成哪個狀態。選「不寫回」代表只改這邊、Mantis 不動(「待審核」是這邊自己的流程,預設不寫回)。">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>本系統狀態</th>
                  <th className={th}>寫回 Mantis 的狀態</th>
                </tr>
              </thead>
              <tbody>
                {WRITE_STATUSES.map((s) => (
                  <tr key={s}>
                    <td className="px-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-200">{RISK_STATUS_LABELS[s]}</td>
                    <td className="px-2 py-0.5">
                      <select
                        value={mapping.statusOut[s]?.id ?? ""}
                        onChange={(e) => {
                          const next = { ...mapping.statusOut };
                          const ref = pick(enums.status, e.target.value);
                          if (ref) next[s] = ref;
                          else delete next[s];
                          set({ statusOut: next });
                        }}
                        className={selectClass}
                      >
                        <option value="">不寫回</option>
                        {mantisOptions(enums.status)}
                      </select>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="px-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-200">寫成 resolved / closed 時帶的 resolution</td>
                  <td className="px-2 py-0.5">
                    <select
                      value={mapping.resolutionOut?.id ?? ""}
                      onChange={(e) => set({ resolutionOut: pick(enums.resolution, e.target.value) })}
                      className={selectClass}
                    >
                      <option value="">不帶</option>
                      {mantisOptions(enums.resolution)}
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section title="本系統 → Mantis:衝擊寫回的嚴重度">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>衝擊</th>
                  <th className={th}>寫回 Mantis 的嚴重度</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((n) => (
                  <tr key={n}>
                    <td className="px-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-200">{n}</td>
                    <td className="px-2 py-0.5">
                      <select
                        value={mapping.severityOut[String(n)]?.id ?? ""}
                        onChange={(e) => {
                          const next = { ...mapping.severityOut };
                          const ref = pick(enums.severity, e.target.value);
                          if (ref) next[String(n)] = ref;
                          else delete next[String(n)];
                          set({ severityOut: next });
                        }}
                        className={selectClass}
                      >
                        <option value="">不寫回</option>
                        {mantisOptions(enums.severity)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            title="處理人對應"
            hint={`寫回「處理人」時,先用 Email 比對本系統使用者與 Mantis 使用者(同步時從問題的處理人、回報人收集到 ${loaded.mantisUsers.length} 位);Email 對不上的人,在這裡手動指定。`}
          >
            <div className="space-y-1">
              {Object.entries(mapping.handlerOverrides).map(([userId, mantisId]) => (
                <div key={userId} className="flex flex-wrap items-center gap-2">
                  <select
                    value={userId}
                    onChange={(e) => {
                      const next = { ...mapping.handlerOverrides };
                      delete next[userId];
                      next[e.target.value] = mantisId;
                      set({ handlerOverrides: next });
                    }}
                    className={selectClass}
                  >
                    {loaded.localUsers
                      .filter((u) => u.id === userId || !(u.id in mapping.handlerOverrides))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}({u.email})
                        </option>
                      ))}
                  </select>
                  <span className="text-xs text-neutral-500">↔ Mantis</span>
                  <select
                    value={mantisId}
                    onChange={(e) => set({ handlerOverrides: { ...mapping.handlerOverrides, [userId]: Number(e.target.value) } })}
                    className={selectClass}
                  >
                    {loaded.mantisUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.realName || u.name || `#${u.id}`}
                        {u.name && u.realName ? `(${u.name})` : ""} #{u.id}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...mapping.handlerOverrides };
                      delete next[userId];
                      set({ handlerOverrides: next });
                    }}
                    className="text-xs text-neutral-400 hover:text-red-600"
                  >
                    移除
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={loaded.mantisUsers.length === 0 || loaded.localUsers.every((u) => u.id in mapping.handlerOverrides)}
                onClick={() => {
                  const user = loaded.localUsers.find((u) => !(u.id in mapping.handlerOverrides));
                  if (user) set({ handlerOverrides: { ...mapping.handlerOverrides, [user.id]: loaded.mantisUsers[0].id } });
                }}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
                title={loaded.mantisUsers.length === 0 ? "還沒同步到任何 Mantis 使用者" : undefined}
              >
                新增手動對應
              </button>
            </div>
          </Section>

          <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "處理中..." : "儲存並重新同步"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={readEnums}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              從 Mantis 讀取狀態與嚴重度清單
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={reset}
              className="ml-auto rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              還原預設
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
