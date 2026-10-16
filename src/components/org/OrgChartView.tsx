"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  buildOrgForest,
  descendantNodeIds,
  resolveOrgDrop,
  type OrgDropZone,
  type OrgNodeLite,
  type OrgTreeNode,
} from "@/lib/orgTree";
import { levelLabel, managerChain } from "@/lib/approvalLevels";
import {
  createOrgNode,
  deleteOrgNode,
  moveOrgNode,
  moveOrgNodeOrder,
  moveOrgNodeTo,
  renameOrgNode,
  setOrgNodeHead,
  setUserOrgNode,
  type OrgChartData,
  type OrgChartPerson,
} from "@/lib/actions/orgChart";

type RunResult = { error?: string; supervisorsChanged?: number };

const fieldClass =
  "w-full rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-50";
const buttonClass =
  "rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50";

/**
 * 公司組織架構圖:部門成樹(上層在上),每個部門有一位主管、底下掛著成員。選一個部門可以改名、換上層、
 * 指定主管、增減成員;選一個人可以看他的一階(直屬)、二階、三階…主管。管理者才能修改,其他人唯讀。
 * 改完之後,掛在部門底下的人的「所屬主管」會照架構圖重算(伺服器端),簽核與可見範圍沿用。
 */
export function OrgChartView({ data, canEdit }: { data: OrgChartData; canEdit: boolean }) {
  const { nodes, people } = data;
  const router = useRouter();
  const { confirm, notify } = useDialogs();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [hint, setHint] = useState<{ targetId: string; zone: OrgDropZone } | null>(null);
  const hintRef = useRef<typeof hint>(null);
  const pointerX = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // 拖曳中記下滑鼠的橫向位置:放在卡片的左邊、右邊或中間,意思不同。
  useEffect(() => {
    if (!dragId) return;
    const onMove = (event: PointerEvent) => {
      pointerX.current = event.clientX;
    };
    window.addEventListener("pointermove", onMove, true);
    return () => window.removeEventListener("pointermove", onMove, true);
  }, [dragId]);

  const forest = useMemo(() => buildOrgForest(nodes), [nodes]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const membersOf = useMemo(() => {
    const map = new Map<string, OrgChartPerson[]>();
    for (const p of people) if (p.orgNodeId) map.set(p.orgNodeId, [...(map.get(p.orgNodeId) ?? []), p]);
    return map;
  }, [people]);

  const selected = selectedId ? (nodeById.get(selectedId) ?? null) : null;

  async function run(work: () => Promise<RunResult>, afterOk?: () => void): Promise<boolean> {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: "無法修改組織架構圖" });
        return false;
      }
      setNote(
        result.supervisorsChanged && result.supervisorsChanged > 0
          ? `剛才的修改讓 ${result.supervisorsChanged} 位同仁的直屬主管跟著改變了。`
          : ""
      );
      afterOk?.();
      router.refresh();
      return true;
    } catch {
      await notify("操作失敗,請重新整理後再試一次。", { title: "無法修改組織架構圖" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const activator = event.activatorEvent as PointerEvent;
    pointerX.current = activator.clientX;
    setDragId(String(event.active.id));
  }

  /** 滑鼠在哪張卡片上、在它的左 / 中 / 右,決定放下去是排前面、變下層、還是排後面;不能放的位置不標示。 */
  function handleDragMove(event: DragMoveEvent) {
    const over = event.over;
    const card = over ? document.querySelector(`[data-org-node="${over.id}"]`) : null;
    let next: typeof hint = null;
    if (card) {
      const rect = card.getBoundingClientRect();
      const ratio = (pointerX.current - rect.left) / rect.width;
      const zone: OrgDropZone = ratio < 0.3 ? "before" : ratio > 0.7 ? "after" : "child";
      if (resolveOrgDrop(nodes, String(event.active.id), String(over!.id), zone)) next = { targetId: String(over!.id), zone };
    }
    if (next?.targetId !== hintRef.current?.targetId || next?.zone !== hintRef.current?.zone) {
      hintRef.current = next;
      setHint(next);
    }
  }

  function endDrag() {
    hintRef.current = null;
    setHint(null);
    setDragId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const target = hintRef.current;
    const draggedId = String(event.active.id);
    endDrag();
    if (!target) return;
    const placement = resolveOrgDrop(nodes, draggedId, target.targetId, target.zone);
    if (!placement) return;
    // 放進一個收合著的部門裡,展開它,才看得到剛放進去的。
    if (target.zone === "child") {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(target.targetId);
        return next;
      });
    }
    void run(() => moveOrgNodeTo(draggedId, placement.parentId, placement.index));
  }

  function renderBranch(item: OrgTreeNode, depth: number) {
    const { node, children } = item;
    const head = node.headId ? personById.get(node.headId) : undefined;
    const isCollapsed = collapsed.has(node.id);
    return (
      <li key={node.id}>
        <OrgNodeCard
          node={node}
          headName={head?.name}
          depth={depth}
          memberCount={membersOf.get(node.id)?.length ?? 0}
          childCount={children.length}
          collapsed={isCollapsed}
          selected={selectedId === node.id}
          canEdit={canEdit && !busy}
          dragging={dragId === node.id}
          dropZone={hint?.targetId === node.id ? hint.zone : null}
          onSelect={() => setSelectedId(node.id)}
          onToggle={() => toggle(node.id)}
        />
        {children.length > 0 && !isCollapsed && <ul>{children.map((child) => renderBranch(child, depth + 1))}</ul>}
      </li>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">組織架構圖</h1>
        <p className="mt-1 max-w-3xl text-xs text-neutral-500 dark:text-neutral-400">
          部門成樹(上層在上),每個部門有一位主管、底下掛著成員。誰是誰的直屬(一階)、二階、三階…主管由這張圖決定——
          掛在部門底下的人,「所屬主管」會照這張圖自動算出來,簽核與可見範圍沿用。
          {canEdit ? "點一個部門可以修改;" : ""}右邊可以查任何一個人的主管階層。
        </p>
        {canEdit && (
          <p className="mt-1 max-w-3xl text-xs text-neutral-500 dark:text-neutral-400">
            拖曳部門調整順序與上下層:放在另一個部門的<b>左邊 / 右邊</b>,就排在它的前面 / 後面(同一層);放在它的<b>中間</b>,就變成它的下層。底下的部門會跟著一起移動。
          </p>
        )}
        {note && <p className="mt-2 text-xs text-blue-700 dark:text-blue-300">{note}</p>}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 p-6">
          {nodes.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              還沒有組織架構圖。{canEdit ? "從右邊「新增最上層部門」開始建立(例如公司名稱)。" : "請管理者建立。"}
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onDragCancel={endDrag}
            >
              <div className="w-max min-w-full pb-4">
                <ul className="org-tree">{forest.map((tree) => renderBranch(tree, 1))}</ul>
              </div>
              <DragOverlay dropAnimation={null}>
                {dragId && nodeById.get(dragId) ? (
                  <div className="w-44 cursor-grabbing rounded-lg border border-blue-500 bg-white dark:bg-neutral-900 px-3 py-2 text-center text-sm font-semibold text-neutral-900 dark:text-neutral-100 shadow-lg">
                    {nodeById.get(dragId)!.name}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        <div className="w-full shrink-0 space-y-4 lg:w-80">
          {selected ? (
            <NodePanel
              key={selected.id}
              node={selected}
              nodes={nodes}
              people={people}
              personById={personById}
              nodeById={nodeById}
              members={membersOf.get(selected.id) ?? []}
              canEdit={canEdit}
              busy={busy}
              run={run}
              confirm={confirm}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            canEdit && <AddRootPanel busy={busy} run={run} onCreated={setSelectedId} />
          )}
          <ChainPanel people={people} personById={personById} nodeById={nodeById} />
          <UnassignedPanel people={people} personById={personById} />
        </div>
      </div>
    </div>
  );
}

/** 一個部門的卡片:管理者可以拖,也是放下的目標;拖到上面時用藍線標出會放在左邊、右邊或變成下層。 */
function OrgNodeCard({
  node,
  headName,
  depth,
  memberCount,
  childCount,
  collapsed,
  selected,
  canEdit,
  dragging,
  dropZone,
  onSelect,
  onToggle,
}: {
  node: OrgNodeLite;
  headName: string | undefined;
  depth: number;
  memberCount: number;
  childCount: number;
  collapsed: boolean;
  selected: boolean;
  canEdit: boolean;
  dragging: boolean;
  dropZone: OrgDropZone | null;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const drag = useDraggable({ id: node.id, disabled: !canEdit });
  const drop = useDroppable({ id: node.id, disabled: !canEdit });
  const setRef = (element: HTMLElement | null) => {
    drag.setNodeRef(element);
    drop.setNodeRef(element);
  };
  return (
    <div
      ref={setRef}
      {...drag.listeners}
      data-org-node={node.id}
      onClick={onSelect}
      className={`relative w-44 rounded-lg border bg-white dark:bg-neutral-900 px-3 py-2 text-center text-xs shadow-sm hover:border-blue-400 ${
        canEdit ? "cursor-grab" : "cursor-pointer"
      } ${dragging ? "opacity-40" : ""} ${
        dropZone === "child"
          ? "border-blue-500 ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-950"
          : selected
            ? "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900"
            : "border-neutral-300 dark:border-neutral-600"
      }`}
    >
      {dropZone === "before" && <span data-org-drop="before" className="pointer-events-none absolute -left-2 inset-y-0 w-1 rounded bg-blue-500" />}
      {dropZone === "after" && <span data-org-drop="after" className="pointer-events-none absolute -right-2 inset-y-0 w-1 rounded bg-blue-500" />}
      <p className="break-words text-sm font-semibold text-neutral-900 dark:text-neutral-100">{node.name}</p>
      <p className="mt-0.5 break-words text-neutral-600 dark:text-neutral-300">主管:{headName ?? "(未設)"}</p>
      <p className="mt-1 flex justify-center gap-2 text-[10px] text-neutral-400 dark:text-neutral-500">
        <span>第 {depth} 階</span>
        <span>{memberCount} 人</span>
      </p>
      {childCount > 0 && (
        <button
          type="button"
          data-org-toggle={node.id}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={collapsed ? `展開 ${childCount} 個下層部門` : "收合下層部門"}
          className="absolute -bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:text-blue-600"
        >
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          {collapsed && childCount}
        </button>
      )}
    </div>
  );
}

function PanelCard({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{title}</p>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="關閉" className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-100">
            <X size={14} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function AddRootPanel({
  busy,
  run,
  onCreated,
}: {
  busy: boolean;
  run: (work: () => Promise<RunResult>, afterOk?: () => void) => Promise<boolean>;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <PanelCard title="新增最上層部門">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如:優式機器人" className={fieldClass} />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() =>
            void run(async () => {
              const result = await createOrgNode(name, null);
              if (result.id) onCreated(result.id);
              return result;
            }, () => setName(""))
          }
          className={`${buttonClass} shrink-0`}
        >
          新增
        </button>
      </div>
    </PanelCard>
  );
}

function NodePanel({
  node,
  nodes,
  people,
  personById,
  nodeById,
  members,
  canEdit,
  busy,
  run,
  confirm,
  onClose,
}: {
  node: OrgNodeLite;
  nodes: OrgNodeLite[];
  people: OrgChartPerson[];
  personById: Map<string, OrgChartPerson>;
  nodeById: Map<string, OrgNodeLite>;
  members: OrgChartPerson[];
  canEdit: boolean;
  busy: boolean;
  run: (work: () => Promise<RunResult>, afterOk?: () => void) => Promise<boolean>;
  confirm: (message: string, options?: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(node.name);
  const [childName, setChildName] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const blockedParents = useMemo(() => descendantNodeIds(nodes, node.id), [nodes, node.id]);
  const head = node.headId ? personById.get(node.headId) : undefined;
  const sortedPeople = useMemo(() => [...people].sort((a, b) => a.name.localeCompare(b.name, "zh-TW")), [people]);
  const parent = node.parentId ? nodeById.get(node.parentId) : undefined;

  return (
    <PanelCard title={`部門:${node.name}`} onClose={onClose}>
      <div className="space-y-3 text-xs text-neutral-700 dark:text-neutral-200">
        {canEdit ? (
          <>
            <div className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} aria-label="部門名稱" />
              <button
                type="button"
                disabled={busy || !name.trim() || name.trim() === node.name}
                onClick={() => void run(() => renameOrgNode(node.id, name))}
                className={`${buttonClass} shrink-0`}
              >
                改名
              </button>
            </div>

            <label className="block text-neutral-500 dark:text-neutral-400">
              主管
              <select
                value={node.headId ?? ""}
                disabled={busy}
                onChange={(e) => void run(() => setOrgNodeHead(node.id, e.target.value || null))}
                className={`${fieldClass} mt-1`}
              >
                <option value="">(未設)</option>
                {sortedPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-neutral-500 dark:text-neutral-400">
              上層部門
              <select
                value={node.parentId ?? ""}
                disabled={busy}
                onChange={(e) => void run(() => moveOrgNode(node.id, e.target.value || null))}
                className={`${fieldClass} mt-1`}
              >
                <option value="">(最上層)</option>
                {nodes
                  .filter((n) => !blockedParents.has(n.id))
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
            </label>

            <div className="flex items-center gap-2">
              <span className="text-neutral-500 dark:text-neutral-400">同一層的順序</span>
              <button type="button" disabled={busy} onClick={() => void run(() => moveOrgNodeOrder(node.id, "up"))} aria-label="往前移" className="rounded border border-neutral-300 dark:border-neutral-600 p-1 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                <ArrowUp size={12} />
              </button>
              <button type="button" disabled={busy} onClick={() => void run(() => moveOrgNodeOrder(node.id, "down"))} aria-label="往後移" className="rounded border border-neutral-300 dark:border-neutral-600 p-1 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                <ArrowDown size={12} />
              </button>
            </div>
          </>
        ) : (
          <>
            <p>主管:{head?.name ?? "(未設)"}</p>
            <p>上層部門:{parent?.name ?? "(最上層)"}</p>
          </>
        )}

        <div>
          <p className="mb-1 font-medium text-neutral-800 dark:text-neutral-100">成員({members.length})</p>
          {members.length === 0 ? (
            <p className="text-neutral-400 dark:text-neutral-500">還沒有成員。</p>
          ) : (
            <ul className="space-y-1">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate">
                    {m.name}
                    {m.id === node.headId && <span className="ml-1 text-[10px] text-blue-600 dark:text-blue-300">主管</span>}
                    <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                      直屬:{m.supervisorId ? (personById.get(m.supervisorId)?.name ?? "?") : "—"}
                    </span>
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => setUserOrgNode(m.id, null))}
                      title="移出架構圖(所屬主管回到手動指定)"
                      className="shrink-0 rounded p-0.5 text-neutral-400 hover:text-red-600"
                    >
                      <X size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="mt-2 flex gap-2">
              <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className={fieldClass} aria-label="加入成員">
                <option value="">加入成員…</option>
                {sortedPeople
                  .filter((p) => p.orgNodeId !== node.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.orgNodeId ? `(現在:${nodeById.get(p.orgNodeId)?.name ?? "?"})` : ""}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={busy || !addUserId}
                onClick={() => void run(() => setUserOrgNode(addUserId, node.id), () => setAddUserId(""))}
                className={`${buttonClass} shrink-0`}
              >
                加入
              </button>
            </div>
          )}
        </div>

        {canEdit && (
          <>
            <div className="flex gap-2">
              <input value={childName} onChange={(e) => setChildName(e.target.value)} placeholder="新增下層部門…" className={fieldClass} />
              <button
                type="button"
                disabled={busy || !childName.trim()}
                onClick={() => void run(() => createOrgNode(childName, node.id), () => setChildName(""))}
                className={`${buttonClass} flex shrink-0 items-center gap-1`}
              >
                <Plus size={12} /> 新增
              </button>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await confirm(`刪除部門「${node.name}」?`, { title: "刪除部門", confirmLabel: "刪除", danger: true });
                if (!ok) return;
                await run(() => deleteOrgNode(node.id), () => onClose());
              }}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              <Trash2 size={12} /> 刪除這個部門(要先清空成員與下層部門)
            </button>
          </>
        )}
      </div>
    </PanelCard>
  );
}

/** 查某個人頭上的主管:一階(直屬)、二階、三階… */
function ChainPanel({
  people,
  personById,
  nodeById,
}: {
  people: OrgChartPerson[];
  personById: Map<string, OrgChartPerson>;
  nodeById: Map<string, OrgNodeLite>;
}) {
  const [userId, setUserId] = useState("");
  const sorted = useMemo(() => [...people].sort((a, b) => a.name.localeCompare(b.name, "zh-TW")), [people]);
  const chain = useMemo(() => (userId ? managerChain(people, userId) : []), [people, userId]);
  const person = userId ? personById.get(userId) : undefined;
  return (
    <PanelCard title="查主管階層">
      <select value={userId} onChange={(e) => setUserId(e.target.value)} className={fieldClass} aria-label="選擇人員">
        <option value="">選一個人…</option>
        {sorted.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {person && (
        <div className="mt-2 text-xs text-neutral-700 dark:text-neutral-200" data-chain-result>
          <p className="mb-1 text-neutral-500 dark:text-neutral-400">
            {person.name}
            {person.orgNodeId ? `(${nodeById.get(person.orgNodeId)?.name ?? ""})` : "(未掛在架構圖,主管為手動指定)"}
          </p>
          {chain.length === 0 ? (
            <p className="text-neutral-400 dark:text-neutral-500">沒有主管。</p>
          ) : (
            <ol className="space-y-0.5">
              {chain.map((id, index) => {
                const manager = personById.get(id);
                return (
                  <li key={id}>
                    <span className="mr-1.5 inline-block w-16 text-neutral-500 dark:text-neutral-400">{levelLabel(index + 1)}</span>
                    {manager?.name ?? "?"}
                    {manager?.orgNodeId && (
                      <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                        {nodeById.get(manager.orgNodeId)?.name}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </PanelCard>
  );
}

/** 還沒掛在任何部門底下的人:他們的主管仍是手動指定的(使用者管理)。 */
function UnassignedPanel({ people, personById }: { people: OrgChartPerson[]; personById: Map<string, OrgChartPerson> }) {
  const loose = people.filter((p) => !p.orgNodeId);
  if (loose.length === 0 || loose.length === people.length) return null;
  return (
    <PanelCard title={`尚未掛在架構圖的人(${loose.length})`}>
      <p className="mb-1 text-[11px] text-neutral-400 dark:text-neutral-500">他們的所屬主管仍是在「使用者管理」手動指定的。</p>
      <ul className="max-h-40 space-y-0.5 overflow-auto text-xs text-neutral-700 dark:text-neutral-200">
        {loose.map((p) => (
          <li key={p.id}>
            {p.name}
            <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">
              直屬:{p.supervisorId ? (personById.get(p.supervisorId)?.name ?? "?") : "—"}
            </span>
          </li>
        ))}
      </ul>
    </PanelCard>
  );
}
