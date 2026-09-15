"use client";

import { useMemo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, GripVertical, Lock, Trash2 } from "lucide-react";
import type { GroupData, ColumnData, ItemData, UserOption } from "@/types/board";
import type { UserRole } from "@prisma/client";
import { canManageStructure, canManageGroupStructure } from "@/lib/permissions";
import { resolveGroupRoleAccess, groupDisciplineTeamUserIds } from "@/lib/groupRoles";
import { ItemRow } from "./ItemRow";
import { gridTemplate, frozenPaneWidth } from "./gridTemplate";
import { renameGroup, deleteGroup } from "@/lib/actions/group";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { createItem } from "@/lib/actions/item";
import { VisibilityModal } from "./VisibilityModal";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { computeWbsCodes } from "@/lib/wbs";
import type { ScheduleLock } from "@/lib/predecessorLink";
import type { PredLamp } from "@/lib/predLamp";

export function GroupSection({
  boardId,
  group,
  items,
  columns,
  users,
  progressColumnId,
  ganttStartColumnId,
  ganttDurationColumnId,
  ganttEndColumnId,
  predColumnId,
  linkColumnId,
  lagColumnId,
  otherGroups,
  manualStartColumnId,
  manualDurationColumnId,
  lockedScheduleFields,
  userRole,
  currentUserId,
  visibleIds,
  nameWidth,
  highlightItemId,
  expandIds,
  levelColors,
  nameColors,
  predLamps,
  selectedIds,
  onToggleSelected,
  manualScheduleHint,
  collapsedIds,
  onToggleCollapse,
  onExpandGroup,
  onCollapseGroup,
  registerScrollPane,
  onPaneScroll,
}: {
  boardId: string;
  group: GroupData;
  items: ItemData[];
  columns: ColumnData[];
  users: UserOption[];
  progressColumnId: string | null;
  ganttStartColumnId: string | null;
  ganttDurationColumnId: string | null;
  ganttEndColumnId: string | null;
  predColumnId?: string | null;
  /** For the item card's 相關項目 list — see listDependentItems. */
  linkColumnId?: string | null;
  lagColumnId?: string | null;
  /** The board's other groups, for the Pred picker — a dependency may now
   *  cross one. */
  otherGroups: { id: string; name: string; items: ItemData[] }[];
  manualStartColumnId?: string | null;
  manualDurationColumnId?: string | null;
  lockedScheduleFields: Map<string, ScheduleLock>;
  userRole: UserRole;
  currentUserId: string;
  visibleIds: Set<string> | null;
  nameWidth: number;
  highlightItemId?: string | null;
  expandIds?: Set<string>;
  levelColors?: string[];
  nameColors?: Map<string, string>;
  /** Per-item Pred lamp — see resolvePredLamps. */
  predLamps?: Map<string, PredLamp>;
  /** Rows ticked for a bulk edit; absent when selection is off. */
  selectedIds?: Set<string>;
  onToggleSelected?: (itemId: string, selected: boolean) => void;
  manualScheduleHint?: string;
  collapsedIds: Set<string>;
  onToggleCollapse: (itemId: string) => void;
  onExpandGroup: () => void;
  onCollapseGroup: () => void;
  registerScrollPane: (key: string, el: HTMLDivElement | null) => void;
  onPaneScroll: (key: string) => void;
}) {
  const wbsCodes = useMemo(() => computeWbsCodes(items), [items]);

  // Items in the board's OTHER groups, offered by the Pred picker so a
  // dependency can cross a group. Their WBS code is prefixed with the group
  // name: a code is a position within its own group's tree, so "1.2" means a
  // different task in each of them.
  const crossGroupPredOptions = useMemo(
    () =>
      otherGroups.flatMap((other) => {
        const codes = computeWbsCodes(other.items);
        return other.items
          .map((i) => ({ id: i.id, code: `${other.name} · ${codes.get(i.id) ?? ""}`, name: i.name }))
          .filter((o) => !o.code.endsWith(" · "));
      }),
    [otherGroups]
  );
  const canEditStructure = canManageStructure(userRole);
  const myGroupAccess = useMemo(
    () => resolveGroupRoleAccess(group.roleAssignments.filter((a) => a.userId === currentUserId)),
    [group.roleAssignments, currentUserId]
  );
  const groupTeamUserIds = useMemo(
    () => groupDisciplineTeamUserIds(group.members, myGroupAccess),
    [group.members, myGroupAccess]
  );
  const canCreateItems = canManageGroupStructure(userRole, myGroupAccess.disciplines.size > 0);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id, disabled: !canEditStructure });
  const [collapsed, setCollapsed] = useState(false);
  const [name, setName] = useState(group.name);
  const [newItemName, setNewItemName] = useState("");
  const { notify } = useDialogs();
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const scrollPaneKey = `group:${group.id}`;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  function saveName() {
    if (name.trim() && name !== group.name) {
      renameGroup(boardId, group.id, name.trim());
    } else {
      setName(group.name);
    }
  }

  const [adding, setAdding] = useState(false);

  async function handleAddItem() {
    if (!newItemName.trim() || adding) return;
    setAdding(true);
    try {
      await createItem(boardId, group.id, newItemName.trim());
      // Cleared only on success — a failed add should leave what was typed,
      // not make the person retype it.
      setNewItemName("");
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "新增失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : "無法新增項目" }
      );
    } finally {
      setAdding(false);
    }
  }

  const topLevelItems = items
    .filter((item) => item.parentId === null)
    .filter((item) => visibleIds === null || visibleIds.has(item.id))
    .sort((a, b) => a.order - b.order);

  return (
    <div
      ref={setNodeRef}
      data-group-id={group.id}
      style={style}
      className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
    >
      <div
        className="flex items-center gap-2 border-b border-neutral-100 dark:border-neutral-700 px-2 py-2"
        style={{ borderLeft: `4px solid ${group.color}` }}
      >
        {canEditStructure && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab text-neutral-300 dark:text-neutral-600 hover:text-neutral-500 dark:hover:text-neutral-400"
          >
            <GripVertical size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-neutral-500 dark:text-neutral-400"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          readOnly={!canEditStructure}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400"
        />
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          {visibleIds === null
            ? items.length
            : `${items.filter((i) => visibleIds.has(i.id)).length} / ${items.length}`}{" "}
          項目
        </span>
        <button
          type="button"
          onClick={onExpandGroup}
          title="展開此分組"
          className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
        >
          <ChevronsDown size={13} />
        </button>
        <button
          type="button"
          onClick={onCollapseGroup}
          title="收合此分組"
          className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-100"
        >
          <ChevronsUp size={13} />
        </button>
        {canEditStructure && (
          <RowMenu>
            <RowMenuItem onSelect={() => setVisibilityOpen(true)}>
              <span className="flex items-center gap-2">
                <Lock size={14} /> 可見範圍
              </span>
            </RowMenuItem>
            <RowMenuItem danger onSelect={() => deleteGroup(boardId, group.id)}>
              <span className="flex items-center gap-2">
                <Trash2 size={14} /> 刪除分組
              </span>
            </RowMenuItem>
          </RowMenu>
        )}
      </div>

      {!collapsed && (
        <div className="flex items-start">
          <div className="shrink-0" style={{ width: frozenPaneWidth(nameWidth) }}>
            {topLevelItems.map((item) => (
              <ItemRow
                key={item.id}
                pane="frozen"
                boardId={boardId}
                groupId={group.id}
                item={item}
                allGroupItems={items}
                columns={columns}
                users={users}
                progressColumnId={progressColumnId}
                ganttStartColumnId={ganttStartColumnId}
                ganttDurationColumnId={ganttDurationColumnId}
                ganttEndColumnId={ganttEndColumnId}
                predColumnId={predColumnId}
                linkColumnId={linkColumnId}
                lagColumnId={lagColumnId}
                manualStartColumnId={manualStartColumnId}
                manualDurationColumnId={manualDurationColumnId}
                lockedScheduleFields={lockedScheduleFields}
                userRole={userRole}
                currentUserId={currentUserId}
                visibleIds={visibleIds}
                nameWidth={nameWidth}
                wbsCodes={wbsCodes}
                crossGroupPredOptions={crossGroupPredOptions}
                highlightItemId={highlightItemId}
                expandIds={expandIds}
                levelColors={levelColors}
                nameColors={nameColors}
                predLamps={predLamps}
                selectedIds={selectedIds}
                onToggleSelected={onToggleSelected}
                manualScheduleHint={manualScheduleHint}
                collapsedIds={collapsedIds}
                onToggleCollapse={onToggleCollapse}
                hasGroupScheduleRole={myGroupAccess.hasScheduleRole}
                hasGroupStructureRole={myGroupAccess.disciplines.size > 0}
                groupTeamUserIds={groupTeamUserIds}
              />
            ))}
            {canCreateItems && (
              <div className="flex h-9 items-center">
                <input
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                  onBlur={handleAddItem}
                  placeholder="+ 新增項目"
                  className="ml-8 min-w-0 flex-1 rounded bg-white dark:bg-neutral-900 px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400 outline-none hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:text-neutral-900 dark:focus:text-neutral-100 focus:ring-1 focus:ring-blue-400"
                />
              </div>
            )}
          </div>
          <div
            ref={(el) => registerScrollPane(scrollPaneKey, el)}
            onScroll={() => onPaneScroll(scrollPaneKey)}
            className="no-scrollbar min-w-0 flex-1 overflow-x-auto"
          >
            {topLevelItems.map((item) => (
              <ItemRow
                key={item.id}
                pane="data"
                boardId={boardId}
                groupId={group.id}
                item={item}
                allGroupItems={items}
                columns={columns}
                users={users}
                progressColumnId={progressColumnId}
                ganttStartColumnId={ganttStartColumnId}
                ganttDurationColumnId={ganttDurationColumnId}
                ganttEndColumnId={ganttEndColumnId}
                predColumnId={predColumnId}
                linkColumnId={linkColumnId}
                lagColumnId={lagColumnId}
                manualStartColumnId={manualStartColumnId}
                manualDurationColumnId={manualDurationColumnId}
                lockedScheduleFields={lockedScheduleFields}
                userRole={userRole}
                currentUserId={currentUserId}
                visibleIds={visibleIds}
                nameWidth={nameWidth}
                wbsCodes={wbsCodes}
                crossGroupPredOptions={crossGroupPredOptions}
                highlightItemId={highlightItemId}
                expandIds={expandIds}
                levelColors={levelColors}
                nameColors={nameColors}
                predLamps={predLamps}
                selectedIds={selectedIds}
                onToggleSelected={onToggleSelected}
                manualScheduleHint={manualScheduleHint}
                collapsedIds={collapsedIds}
                onToggleCollapse={onToggleCollapse}
                hasGroupScheduleRole={myGroupAccess.hasScheduleRole}
                hasGroupStructureRole={myGroupAccess.disciplines.size > 0}
                groupTeamUserIds={groupTeamUserIds}
              />
            ))}
            {canCreateItems && (
              <div
                className="grid h-9 w-fit items-center"
                style={{ gridTemplateColumns: gridTemplate(columns.length) }}
              />
            )}
          </div>
        </div>
      )}

      <VisibilityModal
        target={visibilityOpen ? { kind: "group", id: group.id, name: group.name } : null}
        users={users}
        open={visibilityOpen}
        onOpenChange={setVisibilityOpen}
      />
    </div>
  );
}
