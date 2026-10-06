"use client";

import { UserSelect } from "@/components/ui/UserSelect";
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  createResource,
  updateResource,
  deleteResource,
  reorderResources,
  listResources,
} from "@/lib/actions/resource";
import { HScrollPane } from "@/components/ui/HScrollPane";

type ResourceRow = Awaited<ReturnType<typeof listResources>>[number];
type UserOption = { id: string; name: string };

const ROW_GRID = "grid-cols-[24px_1fr_120px_1fr_1fr_120px_80px]";

function SortableResourceRow({
  resource,
  onEdit,
  onDelete,
}: {
  resource: ResourceRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: resource.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid ${ROW_GRID} items-center gap-2 border-b border-neutral-100 dark:border-neutral-700 px-4 py-2.5 text-sm last:border-b-0`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-neutral-300 dark:text-neutral-600 hover:text-neutral-500 dark:hover:text-neutral-400"
        aria-label="拖曳排序"
      >
        <GripVertical size={14} />
      </button>
      <span className="truncate text-neutral-800 dark:text-neutral-100">{resource.name}</span>
      <span className="truncate text-neutral-500 dark:text-neutral-400">{resource.category || "—"}</span>
      <span className="truncate text-neutral-500 dark:text-neutral-400">{resource.contact || "—"}</span>
      <span className="truncate text-neutral-400 dark:text-neutral-500">{resource.note || "—"}</span>
      <span className="truncate text-neutral-600 dark:text-neutral-400">{resource.manager?.name || "—"}</span>
      <span className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="text-neutral-400 dark:text-neutral-500 hover:text-blue-600"
          aria-label="編輯資源"
          title="編輯"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-neutral-400 dark:text-neutral-500 hover:text-red-600"
          aria-label="刪除資源"
          title="刪除"
        >
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  );
}

export function ResourceManagement({
  resources,
  users,
}: {
  resources: ResourceRow[];
  users: UserOption[];
}) {
  const [prevResources, setPrevResources] = useState(resources);
  const [order, setOrder] = useState(() => resources.map((r) => r.id));
  if (resources !== prevResources) {
    setPrevResources(resources);
    setOrder(resources.map((r) => r.id));
  }
  const resourcesById = new Map(resources.map((r) => [r.id, r]));
  const orderedResources = order
    .map((id) => resourcesById.get(id))
    .filter((r): r is ResourceRow => r !== undefined);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [managerId, setManagerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [editTarget, setEditTarget] = useState<ResourceRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editContact, setEditContact] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editManagerId, setEditManagerId] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { confirm } = useDialogs();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function reset() {
    setName("");
    setCategory("");
    setContact("");
    setNote("");
    setManagerId("");
    setError(null);
  }

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      await createResource(name, category || null, contact || null, note || null, managerId || null);
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增失敗");
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(resource: ResourceRow) {
    setEditTarget(resource);
    setEditName(resource.name);
    setEditCategory(resource.category ?? "");
    setEditContact(resource.contact ?? "");
    setEditNote(resource.note ?? "");
    setEditManagerId(resource.managerId ?? "");
    setEditError(null);
  }

  async function handleEditSave() {
    if (!editTarget) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await updateResource(
        editTarget.id,
        editName,
        editCategory || null,
        editContact || null,
        editNote || null,
        editManagerId || null
      );
      setEditTarget(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "修改失敗");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(resource: ResourceRow) {
    const ok = await confirm(`確定要刪除資源「${resource.name}」嗎?此操作無法復原。`, {
      title: "刪除資源",
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    setDeleteError(null);
    try {
      await deleteResource(resource.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "刪除失敗");
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((ids) => {
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      const next = arrayMove(ids, oldIndex, newIndex);
      reorderResources(next);
      return next;
    });
  }

  return (
    <div>
      {deleteError && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {deleteError}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={14} /> 新增資源
        </button>
      </div>

      <HScrollPane className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
        <div
          className={`grid ${ROW_GRID} gap-2 border-b border-neutral-100 dark:border-neutral-700 px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400`}
        >
          <span />
          <span>名稱</span>
          <span>類別</span>
          <span>聯絡人/方式</span>
          <span>備註</span>
          <span>負責窗口</span>
          <span />
        </div>
        {orderedResources.length === 0 ? (
          <p className="p-4 text-sm text-neutral-400 dark:text-neutral-500">尚無資源</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {orderedResources.map((r) => (
                <SortableResourceRow
                  key={r.id}
                  resource={r}
                  onEdit={() => openEdit(r)}
                  onDelete={() => handleDelete(r)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </HScrollPane>

      <Modal
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
        title="新增資源"
      >
        {error && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名稱"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="類別(例如:工具、廠商、設備)"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="聯絡人/聯絡方式"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="備註"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <UserSelect users={users} value={managerId} onChange={setManagerId} emptyLabel="負責窗口(未設定)" className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <button
            type="button"
            disabled={submitting || !name.trim()}
            onClick={handleCreate}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "新增中..." : "新增"}
          </button>
        </div>
      </Modal>

      <Modal
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
        title="編輯資源"
      >
        {editError && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {editError}
          </div>
        )}
        <div className="space-y-3">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="名稱"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={editCategory}
            onChange={(e) => setEditCategory(e.target.value)}
            placeholder="類別(例如:工具、廠商、設備)"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={editContact}
            onChange={(e) => setEditContact(e.target.value)}
            placeholder="聯絡人/聯絡方式"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="備註"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <UserSelect users={users} value={editManagerId} onChange={setEditManagerId} emptyLabel="負責窗口(未設定)" className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          <button
            type="button"
            disabled={editSubmitting || !editName.trim()}
            onClick={handleEditSave}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {editSubmitting ? "儲存中..." : "儲存"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
