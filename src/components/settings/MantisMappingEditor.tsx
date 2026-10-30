"use client";

import { useEffect, useRef, useState } from "react";
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
import { MATCH_HOW_LABELS, matchLocalPerson } from "@/lib/mantisPeople";
import { RISK_STATUS_LABELS } from "@/lib/riskRegister";
import { actionErrorMessage } from "@/lib/userError";
import type { RiskStatus } from "@prisma/client";

const selectClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50";
const th = "px-2 py-1 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400";

const enumText = (e: MantisEnumEntry) => (e.label && e.label !== e.name ? `${e.label}(${e.name})` : e.name) + ` #${e.id}`;
const READ_STATUSES: RiskStatus[] = ["OPEN", "MITIGATING", "CLOSED"];
const WRITE_STATUSES: RiskStatus[] = ["OPEN", "MITIGATING", "PENDING_REVIEW", "CLOSED"];

type Loaded = {
  mapping: MantisMapping;
  mantisUsers: MantisUser[];
  localUsers: { id: string; name: string; email: string }[];
  handlerCounts: Record<number, number>;
};

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
  // notify 與 onOpenChange 每次重新渲染都是新的函式:放進讀取設定的 effect 依賴裡,跳出一個通知就會重讀、把還沒儲存的修改蓋掉。
  const notifyRef = useRef(notify);
  const closeRef = useRef(onOpenChange);
  useEffect(() => {
    notifyRef.current = notify;
    closeRef.current = onOpenChange;
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await getMantisMapping(boardId);
        if (cancelled) return;
        if ("error" in result) {
          await notifyRef.current(result.error, { title: "無法讀取設定" });
          closeRef.current(false);
          return;
        }
        setLoaded(result);
        setMapping(result.mapping);
      } catch (err) {
        if (!cancelled) {
          await notifyRef.current(actionErrorMessage(err, "讀取失敗"), { title: "無法讀取設定" });
          closeRef.current(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

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
            hint="Mantis 的處理人要對到本系統的哪位負責人(寫回處理人時也用這張對應)。依序比對:這裡手動指定的 → Email 相同(Mantis 常常不回 Email)→ 名稱相同(Mantis 的使用者名稱或姓名,跟本系統同仁的姓名或 Email 帳號,忽略大小寫與空白、底線、點;只有一位符合才算)。對不上的人,在右邊直接指定,存檔後馬上套用。"
          >
            {loaded.mantisUsers.length === 0 ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">還沒有同步到任何 Mantis 使用者,先按「立即同步」一次。</p>
            ) : (
              <table className="w-full" data-handler-table>
                <thead>
                  <tr>
                    <th className={th}>Mantis 使用者</th>
                    <th className={th}>處理中的問題</th>
                    <th className={th}>對應到本系統同仁</th>
                  </tr>
                </thead>
                <tbody>
                  {[...loaded.mantisUsers]
                    .sort((x, y) => (loaded.handlerCounts[y.id] ?? 0) - (loaded.handlerCounts[x.id] ?? 0) || x.id - y.id)
                    .map((u) => {
                      const manual = Object.entries(mapping.handlerOverrides).find(([, mantisId]) => mantisId === u.id)?.[0] ?? "";
                      const auto = matchLocalPerson({ id: u.id, name: u.name, realName: u.realName, email: u.email }, loaded.localUsers, {});
                      const autoName = auto ? loaded.localUsers.find((l) => l.id === auto.userId)?.name : null;
                      const count = loaded.handlerCounts[u.id] ?? 0;
                      const unmatched = !manual && !auto;
                      return (
                        <tr key={u.id} data-mantis-user={u.id}>
                          <td className="px-2 py-0.5 text-sm text-neutral-700 dark:text-neutral-200">
                            {u.realName || u.name || `#${u.id}`}
                            {u.name && u.realName ? `(${u.name})` : ""} <span className="text-xs text-neutral-400">#{u.id}</span>
                          </td>
                          <td className="px-2 py-0.5 text-sm text-neutral-500 dark:text-neutral-400">{count > 0 ? `${count} 筆` : "—"}</td>
                          <td className="px-2 py-0.5">
                            <select
                              value={manual}
                              onChange={(e) => {
                                const next = { ...mapping.handlerOverrides };
                                for (const [userId, mantisId] of Object.entries(next)) if (mantisId === u.id) delete next[userId];
                                if (e.target.value) next[e.target.value] = u.id;
                                set({ handlerOverrides: next });
                              }}
                              className={selectClass}
                            >
                              <option value="">{auto && autoName ? `自動:${autoName}(${MATCH_HOW_LABELS[auto.how]})` : "自動:對不到"}</option>
                              {loaded.localUsers.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}({l.email})
                                </option>
                              ))}
                            </select>
                            {unmatched && count > 0 && <span className="ml-2 text-xs text-red-600 dark:text-red-400">對不上,這 {count} 筆沒有負責人</span>}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
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
