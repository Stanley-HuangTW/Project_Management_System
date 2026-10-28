"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { ProtoRowDialog } from "./ProtoRowDialog";
import { ProtoQtyCell } from "./ProtoQtyCell";
import { ProtoMachineList } from "./ProtoMachineList";
import { ProtoExcelButtons } from "./ProtoExcelButtons";
import { SortableTh, SortableTr } from "./ProtoSortable";
import { ProtoUnitName } from "./ProtoUnitName";
import {
  getProtoPlanView,
  setProtoQty,
  addProtoRow,
  deleteProtoRow,
  renameProtoUnit,
  reorderProtoPhases,
  reorderProtoRows,
  type ProtoPlanView,
} from "@/lib/actions/protoPlan";

/** 拖完階段欄之後,先在畫面上把每一處的階段順序排好(伺服器存好會再載回一次)。 */
function withPhaseOrder(view: ProtoPlanView, ids: string[]): ProtoPlanView {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const byRank = <T extends { phaseId: string }>(list: T[]) => [...list].sort((a, b) => (rank.get(a.phaseId) ?? 0) - (rank.get(b.phaseId) ?? 0));
  return {
    ...view,
    phases: [...view.phases].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
    summary: {
      ...view.summary,
      byPhase: byRank(view.summary.byPhase),
      products: view.summary.products.map((p) => ({
        ...p,
        byPhase: byRank(p.byPhase),
        rows: p.rows.map((r) => ({ ...r, cells: byRank(r.cells) })),
      })),
    },
  };
}

/** 拖完某個產品的用途列之後,先在畫面上排好。 */
function withRowOrder(view: ProtoPlanView, product: string, units: string[]): ProtoPlanView {
  const rank = new Map(units.map((u, i) => [u, i]));
  return {
    ...view,
    summary: {
      ...view.summary,
      products: view.summary.products.map((p) =>
        p.product === product ? { ...p, rows: [...p.rows].sort((a, b) => (rank.get(a.unit) ?? 0) - (rank.get(b.unit) ?? 0)) } : p
      ),
    },
  };
}

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
  const [rowDialog, setRowDialog] = useState<{ defaultProduct?: string } | null>(null);

  const reload = useCallback(async () => setView(await getProtoPlanView(boardId)), [boardId]);
  // 移動超過 5px 才算拖曳,所以把手與格子照常可以點。
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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

  async function run(
    work: () => Promise<{ error?: string; notice?: string }>,
    failTitle: string
  ): Promise<boolean> {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return false;
      }
      await reload();
      // 台數減少、拿掉了樣機:事後告訴使用者(不擋修改)。
      if (result.notice) await notify(result.notice, { title: "樣機已拿掉" });
      return true;
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : failTitle }
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function endPhaseDrag({ active, over }: DragEndEvent) {
    if (!view || !over || active.id === over.id) return;
    const ids = view.phases.map((p) => p.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    setView(withPhaseOrder(view, next));
    if (!(await run(() => reorderProtoPhases(boardId, next), "無法調整階段順序"))) await reload();
  }

  async function endRowDrag(product: string, { active, over }: DragEndEvent) {
    if (!view || !over || active.id === over.id) return;
    const units = view.summary.products.find((p) => p.product === product)?.rows.map((r) => r.unit) ?? [];
    const from = units.indexOf(String(active.id));
    const to = units.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(units, from, to);
    setView(withRowOrder(view, product, next));
    if (!(await run(() => reorderProtoRows(boardId, product, next), "無法調整順序"))) await reload();
  }

  async function renameUnit(product: string, unit: string, next: string) {
    await run(() => renameProtoUnit(boardId, product, unit, next), "無法修改用途單位名稱");
  }

  function addRow(defaultProduct?: string) {
    setRowDialog({ defaultProduct });
  }

  // 格子直接在表上打字存檔:一格接一格 Tab 過去時,不能因為「正在存」就把輸入框鎖住(會丟掉游標),
  // 所以不用 busy;改成照順序一筆一筆存(存台數之後會重算這個階段的材料預算,兩筆同時跑會互相蓋),
  // 全部存完才重新載入一次。
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSaves = useRef(0);
  function saveQty(product: string, unit: string, phaseId: string, qty: number, note: string): Promise<boolean> {
    pendingSaves.current++;
    const job = saveQueue.current.then(async () => {
      try {
        const result = await setProtoQty(boardId, product, unit, phaseId, qty, note);
        if (result.error) {
          await notify(result.error, { title: "無法儲存" });
          return false;
        }
        // 台數減少、拿掉了樣機:事後告訴使用者(不擋修改)。
        if (result.notice) await notify(result.notice, { title: "樣機已拿掉" });
        return true;
      } catch (err) {
        await notify(
          isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗",
          { title: isStaleBuildError(err) ? "需要重新整理" : "無法儲存" }
        );
        return false;
      } finally {
        pendingSaves.current--;
        if (pendingSaves.current === 0) await reload();
      }
    });
    saveQueue.current = job;
    return job;
  }

  async function editNote(product: string, unit: string, phaseId: string, qty: number, note: string) {
    const answer = await prompt("備註?例如 mock up。沒有就留空。", { title: "備註", defaultValue: note });
    if (answer === null) return;
    await saveQty(product, unit, phaseId, qty, answer);
  }

  // 新增一列之後,游標直接跳進那一列第一格,馬上就能打數字。
  const focusAfterAdd = useRef<{ product: string; unit: string } | null>(null);
  useEffect(() => {
    const target = focusAfterAdd.current;
    if (!target) return;
    const first = [...document.querySelectorAll<HTMLInputElement>("input[data-proto-cell]")].find(
      (el) => el.dataset.product === target.product && el.dataset.unit === target.unit
    );
    if (!first) return; // 新的一列還沒載回來,下次 render 再找
    focusAfterAdd.current = null;
    first.focus();
  });

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!view) return null;

  const { phases, summary, canEdit, units } = view;
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
        對得起來。要備多少料看最下面「全部產品」那一列。台數乘上「樣機 BOM」的單台成本,就是這個階段的材料預算(產品名稱要跟 BOM 的一模一樣)。
      </p>

      <ProtoExcelButtons boardId={boardId} canEdit={canEdit} onImported={reload} />

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
            <DndContext key={product.product} sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void endPhaseDrag(e)}>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b-2 border-neutral-300 dark:border-neutral-600">
                  <th className="w-56 py-2 text-left font-semibold text-neutral-800 dark:text-neutral-100">
                    {product.product}
                  </th>
                  <SortableContext items={phases.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
                    {phases.map((phase) => (
                      <SortableTh
                        key={phase.id}
                        id={phase.id}
                        className="py-2 text-right text-xs font-normal text-neutral-500 dark:text-neutral-400"
                      >
                        {(handle) => (
                          <span className="inline-flex items-center justify-end gap-0.5">
                            {canEdit && (
                              <button
                                type="button"
                                {...handle}
                                data-proto-phase-handle={phase.id}
                                title="拖曳調整階段順序(樣機計畫、階段預算、NRE、BOM 共用同一組階段)"
                                aria-label={`拖曳調整「${phase.name}」的順序`}
                                className="cursor-grab touch-none rounded p-0.5 text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-300"
                              >
                                <GripVertical size={12} />
                              </button>
                            )}
                            <span data-proto-phase={phase.id}>{phase.name}</span>
                          </span>
                        )}
                      </SortableTh>
                    ))}
                  </SortableContext>
                  <th className="py-2 text-right text-xs font-normal text-neutral-500 dark:text-neutral-400">
                    合計
                  </th>
                  {canEdit && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void endRowDrag(product.product, e)}>
                <SortableContext items={product.rows.map((r) => r.unit)} strategy={verticalListSortingStrategy}>
                {product.rows.map((row) => (
                  <SortableTr
                    key={row.unit}
                    id={row.unit}
                    dataKey={`${product.product}|${row.unit}`}
                    className="group border-b border-neutral-100 dark:border-neutral-800"
                  >
                    {(handle) => (
                    <>
                    <td className="py-1.5 pr-2 text-neutral-700 dark:text-neutral-200">
                      <div className="flex items-center gap-0.5">
                        {canEdit && (
                          <button
                                type="button"
                                {...handle}
                                data-proto-row-handle={`${product.product}|${row.unit}`}
                                title="拖曳調整順序"
                                aria-label={`拖曳調整「${row.unit}」的順序`}
                                className="cursor-grab touch-none rounded p-0.5 text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-300"
                              >
                                <GripVertical size={12} />
                              </button>
                        )}
                        <ProtoUnitName value={row.unit} canEdit={canEdit} onSave={(next) => renameUnit(product.product, row.unit, next)} />
                      </div>
                    </td>
                    {row.cells.map((cell) => (
                      <td key={cell.phaseId} className="py-1 text-right tabular-nums">
                        <ProtoQtyCell
                          qty={cell.qty}
                          note={cell.note}
                          canEdit={canEdit}
                          label={`${product.product} / ${row.unit} / ${phaseName.get(cell.phaseId) ?? ""}`}
                          product={product.product}
                          unit={row.unit}
                          onCommitQty={(qty) => saveQty(product.product, row.unit, cell.phaseId, qty, cell.note)}
                          onEditNote={(currentQty) =>
                            void editNote(product.product, row.unit, cell.phaseId, currentQty, cell.note)
                          }
                        />
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
                    </>
                    )}
                  </SortableTr>
                ))}
                </SortableContext>
                </DndContext>
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
            </DndContext>
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

      <ProtoMachineList boardId={boardId} machines={view.machines} phaseNames={phaseName} />

      <ProtoRowDialog
        open={rowDialog !== null}
        onOpenChange={(next) => !next && setRowDialog(null)}
        units={units}
        defaultProduct={rowDialog?.defaultProduct}
        onSubmit={async (product, unit) => {
          focusAfterAdd.current = { product: product.trim(), unit: unit.trim() };
          if (!(await run(() => addProtoRow(boardId, product, unit), "無法新增"))) focusAfterAdd.current = null;
        }}
      />
    </div>
  );
}
