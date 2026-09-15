"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { COMMON_PROTO_UNITS } from "@/lib/protoPlan";
import {
  getProtoPlanView,
  setProtoQty,
  addProtoRow,
  deleteProtoRow,
  type ProtoPlanView,
} from "@/lib/actions/protoPlan";

/**
 * 樣機使用計畫:產品 × 用途單位 × 階段 = 幾台。
 *
 * 階段欄位跟人力表共用同一組,所以「EVT 兩台給 SW 做 mock up」跟「EVT 那
 * 三個月 SW 排了幾個人」講的是同一段時間 —— 要備多少料,看的是最下面
 * 「全部產品」那一列。
 */
export function ProtoPlanTable({ boardId }: { boardId: string }) {
  const { notify, confirm, prompt } = useDialogs();
  const [view, setView] = useState<ProtoPlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => setView(await getProtoPlanView(boardId)), [boardId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getProtoPlanView(boardId);
        if (!cancelled) setView(result);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return;
      }
      await reload();
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : failTitle }
      );
    } finally {
      setBusy(false);
    }
  }

  async function addRow(defaultProduct?: string) {
    const product = await prompt("哪個產品?例如 M3、充電站", {
      title: "新增樣機用途",
      defaultValue: defaultProduct ?? "",
    });
    if (product === null || !product.trim()) return;
    const unit = await prompt(
      `用途單位?常見的有:${COMMON_PROTO_UNITS.slice(0, 6).join("、")}……`,
      { title: "新增樣機用途" }
    );
    if (unit === null || !unit.trim()) return;
    await run(() => addProtoRow(boardId, product.trim(), unit.trim()), "無法新增");
  }

  async function editCell(
    product: string,
    unit: string,
    phaseId: string,
    phaseName: string,
    qty: number,
    note: string
  ) {
    const answer = await prompt(`${product} 的 ${unit} 在 ${phaseName} 要幾台?`, {
      title: "設定樣機台數",
      defaultValue: qty > 0 ? String(qty) : "",
      numeric: true,
    });
    if (answer === null || answer.trim() === "") return;
    const next = Number(answer);
    if (!Number.isFinite(next)) return;

    const noteAnswer = await prompt("備註?例如 mock up。沒有就留空。", {
      title: "備註",
      defaultValue: note,
    });
    if (noteAnswer === null) return;
    await run(
      () => setProtoQty(boardId, product, unit, phaseId, Math.round(next), noteAnswer),
      "無法儲存"
    );
  }

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!view) return null;

  const { phases, summary, canEdit } = view;
  const phaseName = new Map(phases.map((p) => [p.id, p.name]));

  if (phases.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-neutral-200 py-10 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
        樣機計畫的欄位是照階段排的。請先到「人力表」建立 EVT、DVT1 這些階段。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        每一格是台數:某個產品、某個用途單位、某個階段要幾台。階段欄位跟人力表共用同一組,所以時間軸
        對得起來。要備多少料看最下面「全部產品」那一列。
      </p>

      {canEdit && (
        <button
          type="button"
          disabled={busy}
          onClick={() => addRow()}
          className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          <Plus size={13} /> 新增用途
        </button>
      )}

      {summary.products.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 py-10 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
          還沒有樣機計畫。
        </p>
      ) : (
        <div className="space-y-5 overflow-x-auto">
          {summary.products.map((product) => (
            <table key={product.product} className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b-2 border-neutral-300 dark:border-neutral-600">
                  <th className="w-56 py-2 text-left font-semibold text-neutral-800 dark:text-neutral-100">
                    {product.product}
                  </th>
                  {phases.map((phase) => (
                    <th
                      key={phase.id}
                      className="py-2 text-right text-xs font-normal text-neutral-500 dark:text-neutral-400"
                    >
                      {phase.name}
                    </th>
                  ))}
                  <th className="py-2 text-right text-xs font-normal text-neutral-500 dark:text-neutral-400">
                    合計
                  </th>
                  {canEdit && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {product.rows.map((row) => (
                  <tr
                    key={row.unit}
                    className="group border-b border-neutral-100 dark:border-neutral-800"
                  >
                    <td className="py-1.5 pr-2 text-neutral-700 dark:text-neutral-200">{row.unit}</td>
                    {row.cells.map((cell) => (
                      <td key={cell.phaseId} className="py-1.5 text-right tabular-nums">
                        <button
                          type="button"
                          disabled={!canEdit || busy}
                          onClick={() =>
                            editCell(
                              product.product,
                              row.unit,
                              cell.phaseId,
                              phaseName.get(cell.phaseId) ?? "",
                              cell.qty,
                              cell.note
                            )
                          }
                          title={cell.note || undefined}
                          className={`w-full rounded px-1.5 py-0.5 text-right disabled:cursor-default ${
                            canEdit ? "hover:bg-neutral-100 dark:hover:bg-neutral-800" : ""
                          }`}
                        >
                          {cell.qty > 0 ? (
                            <span className="text-blue-700 dark:text-blue-300">
                              {cell.qty}
                              {cell.note && (
                                <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                                  ({cell.note})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-neutral-300 dark:text-neutral-700">·</span>
                          )}
                        </button>
                      </td>
                    ))}
                    <td className="py-1.5 text-right tabular-nums text-neutral-700 dark:text-neutral-200">
                      {row.total > 0 ? row.total : "—"}
                    </td>
                    {canEdit && (
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            const ok = await confirm(
                              `刪除「${product.product} / ${row.unit}」這一列?各階段的台數會一起消失。`,
                              { title: "刪除用途", confirmLabel: "刪除", danger: true }
                            );
                            if (ok)
                              await run(
                                () => deleteProtoRow(boardId, product.product, row.unit),
                                "無法刪除"
                              );
                          }}
                          className="rounded p-0.5 text-neutral-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100 disabled:opacity-50 dark:text-neutral-600"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium text-neutral-800 dark:text-neutral-100">
                  <td className="py-2">小計</td>
                  {product.byPhase.map((p) => (
                    <td key={p.phaseId} className="py-2 text-right tabular-nums">
                      {p.qty > 0 ? p.qty : "—"}
                    </td>
                  ))}
                  <td className="bg-amber-50 py-2 text-right tabular-nums dark:bg-amber-950/40">
                    {product.total}
                  </td>
                  {canEdit && (
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => addRow(product.product)}
                        title={`為 ${product.product} 新增一個用途`}
                        className="rounded p-0.5 text-neutral-400 hover:text-blue-600 disabled:opacity-50"
                      >
                        <Plus size={12} />
                      </button>
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          ))}

          {summary.products.length > 1 && (
            <table className="w-full min-w-[640px] border-t-2 border-neutral-300 text-sm dark:border-neutral-600">
              <tbody>
                <tr className="font-semibold text-neutral-800 dark:text-neutral-100">
                  <td className="w-56 py-2">全部產品</td>
                  {summary.byPhase.map((p) => (
                    <td key={p.phaseId} className="py-2 text-right tabular-nums">
                      {p.qty > 0 ? p.qty : "—"}
                    </td>
                  ))}
                  <td className="bg-amber-50 py-2 text-right tabular-nums dark:bg-amber-950/40">
                    {summary.total}
                  </td>
                  {canEdit && <td className="w-8" />}
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
