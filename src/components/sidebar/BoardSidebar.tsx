"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  LayoutGrid,
  Plus,
  Pencil,
  Trash2,
  Users,
  Users2,
  Settings,
  Shield,
  Upload,
  Download,
  Zap,
  Copy,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  FolderKanban,
  ClipboardCheck,
  ScrollText,
  FileText,
  History,
  Clock,
  DatabaseBackup,
} from "lucide-react";
import type { UserRole } from "@prisma/client";
import { canManageBoard, canManageStructure } from "@/lib/permissions";
import { Modal } from "@/components/ui/Modal";
import { SearchBox } from "@/components/search/SearchBox";
import { Avatar } from "@/components/ui/Avatar";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useBoardAdminActions, type BoardAdminAction } from "@/components/board/BoardAdminActions";
import { useDialogs } from "@/components/ui/DialogProvider";
import { ProfileModal } from "./ProfileModal";
import { BoardTrashModal } from "./BoardTrashModal";
import { createBoard, renameBoard, deleteBoard } from "@/lib/actions/board";
import { saveSidebarOrder } from "@/lib/actions/sidebarOrder";
import { applyStoredOrder } from "@/lib/sidebarOrder";
import { SortableList } from "@/components/ui/SortableList";
import { logout } from "@/lib/actions/auth";

type Board = { id: string; name: string; ownerId: string };
/** A 專案群組 and how many of its boards this person can open — a group whose
 *  boards are all closed to them is not listed at all. */
type Program = { id: string; name: string; boardCount: number };

/** Board-admin tasks the open board view offers — see BoardAdminActions. */
const ADMIN_ACTIONS: { id: BoardAdminAction; label: string; Icon: typeof Upload }[] = [
  { id: "import", label: "匯入", Icon: Download },
  { id: "export", label: "匯出", Icon: Upload },
  { id: "resources", label: "Resource 對應", Icon: Users2 },
  { id: "automation", label: "自動化", Icon: Zap },
  { id: "templates", label: "專案範本", Icon: Copy },
  { id: "trash", label: "垃圾桶", Icon: Trash2 },
];

const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;
const COLLAPSED_WIDTH = 44;
const STORAGE_KEY_COLLAPSED = "sidebar-collapsed";
const STORAGE_KEY_WIDTH = "sidebar-width";

export function BoardSidebar({
  boards,
  programs,
  isApprover,
  userName,
  userRole,
  currentUserId,
  avatarUrl,
  impersonating = false,
}: {
  boards: Board[];
  programs: Program[];
  /** Whether anybody reports to this person (or they are an ADMIN) — the
   *  審核 link is pointless otherwise. */
  isApprover: boolean;
  userName: string;
  userRole: UserRole;
  currentUserId: string;
  avatarUrl?: string | null;
  /** 管理者正以別人的身分檢視(userName / userRole 是被檢視的人)。 */
  impersonating?: boolean;
}) {
  const canManage = canManageBoard(userRole);
  /** 重新命名/刪除:ADMIN 一律可以;SUPERVISOR 限自己建立的看板。 */
  function canManageThisBoard(board: Board): boolean {
    return canManage || (userRole === "SUPERVISOR" && board.ownerId === currentUserId);
  }
  // 這個人的角色允許做哪些「更多操作」——跟 BoardView 裡 adminActions 那份
  // 算的是同一條規則,但這裡不能等那個看板真的打開才知道:側邊欄列出的是
  // 每一塊看板,使用者點的常常不是正在看的那一塊。
  const allowedAdminActions = new Set<BoardAdminAction>([
    ...(canManage ? (["import", "export", "resources"] as const) : []),
    ...(canManageStructure(userRole) ? (["automation", "templates", "trash"] as const) : []),
  ]);
  const openBoardAdmin = useBoardAdminActions();
  const { confirm, notify } = useDialogs();
  const [profileOpen, setProfileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // 拖曳排序:先照新的順序顯示,存好之後伺服器那份(props)會是同一個順序。props 換了就以它為準。
  const [boardList, setBoardList] = useState(boards);
  const [seenBoards, setSeenBoards] = useState(boards);
  if (boards !== seenBoards) {
    setSeenBoards(boards);
    setBoardList(boards);
  }
  const [programList, setProgramList] = useState(programs);
  const [seenPrograms, setSeenPrograms] = useState(programs);
  if (programs !== seenPrograms) {
    setSeenPrograms(programs);
    setProgramList(programs);
  }

  async function handleReorder(kind: "board" | "program", ids: string[]) {
    if (kind === "board") setBoardList(applyStoredOrder(boardList, ids));
    else setProgramList(applyStoredOrder(programList, ids));
    const result = await saveSidebarOrder(kind, ids).catch(() => ({ error: "無法儲存順序" }));
    if (result.error) {
      if (kind === "board") setBoardList(boards);
      else setProgramList(programs);
      await notify(result.error, { title: "無法儲存順序" });
      return;
    }
    router.refresh();
  }

  // Below md the sidebar is a drawer over the page rather than a column
  // beside it: on a phone there is no room for both.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const [boardTrashOpen, setBoardTrashOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Board | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Per-browser UI preference, not app data — localStorage isn't available
  // during SSR, so start from the default (matches the server-rendered
  // markup) and pick up the stored value after mount to avoid a hydration
  // mismatch.
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    try {
      // Reading a real external system (localStorage, unavailable during
      // SSR) on mount and syncing it into state once is exactly what this
      // effect is for; there's no prop/render-time value to derive it from.
      const storedCollapsed = localStorage.getItem(STORAGE_KEY_COLLAPSED);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (storedCollapsed === "true") setCollapsed(true);
      const storedWidth = Number(localStorage.getItem(STORAGE_KEY_WIDTH));
      if (storedWidth >= MIN_WIDTH && storedWidth <= MAX_WIDTH) setWidth(storedWidth);
    } catch {
      // localStorage unavailable (private mode etc.) — just keep defaults.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_COLLAPSED, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    function onMove(ev: PointerEvent) {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)));
      setWidth(next);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setWidth((current) => {
        try {
          localStorage.setItem(STORAGE_KEY_WIDTH, String(current));
        } catch {
          // ignore
        }
        return current;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleCreate() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const board = await createBoard(newName.trim());
      setCreateOpen(false);
      setNewName("");
      router.push(`/boards/${board.id}`);
    });
  }

  function handleRename() {
    if (!renameTarget || !renameValue.trim()) return;
    startTransition(async () => {
      await renameBoard(renameTarget.id, renameValue.trim());
      setRenameTarget(null);
    });
  }

  async function handleDelete(board: Board) {
    const ok = await confirm(
      `把看板「${board.name}」移到垃圾桶?資料都會留著,之後可以從「看板垃圾桶」還原。`,
      { title: "刪除看板", confirmLabel: "移到垃圾桶", danger: true }
    );
    if (!ok) return;
    startTransition(async () => {
      await deleteBoard(board.id);
      if (pathname === `/boards/${board.id}`) {
        router.push("/boards");
      }
    });
  }

  if (collapsed && !mobileOpen) {
    return (
      <>
        <MobileBar onOpen={() => setMobileOpen(true)} />
        <div
          className="hidden shrink-0 flex-col items-center border-r border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 py-4 md:flex"
          style={{ width: COLLAPSED_WIDTH }}
        >
        <button
          type="button"
          onClick={toggleCollapsed}
          className="rounded p-1.5 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
            aria-label="展開看板選單"
            title="展開看板選單"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <MobileBar onOpen={() => setMobileOpen(true)} />
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}
      <div
        className={`relative shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 ${
          mobileOpen ? "fixed inset-y-0 left-0 z-50 flex" : "hidden md:flex"
        }`}
        style={{ width }}
      >
        {mobileOpen && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="absolute left-3 top-4 z-10 rounded p-1 text-neutral-500 dark:text-neutral-400 md:hidden"
            aria-label="關閉選單"
          >
            <X size={16} />
          </button>
        )}
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden rounded p-1 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100 md:block"
            aria-label="隱藏看板選單"
            title="隱藏看板選單"
          >
            <PanelLeftClose size={15} />
          </button>
          <span className="ml-7 text-sm font-semibold text-neutral-900 dark:text-neutral-100 md:ml-0">看板</span>
        </div>
        {canManageStructure(userRole) && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded p-1 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
            aria-label="新增看板"
          >
            <Plus size={16} />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-2 pb-2">
          <SearchBox />
        </div>
      )}

      <nav className="flex-1 space-y-0.5 overflow-auto px-2" onClick={() => setMobileOpen(false)}>
        <Link
          href="/dashboard"
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
            pathname === "/dashboard"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
        >
          <LayoutDashboard size={14} className="shrink-0" />
          儀表板
        </Link>
        {userRole === "ADMIN" && (
          <Link
            href="/users"
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              pathname === "/users"
                ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            <Users size={14} className="shrink-0" />
            使用者管理
          </Link>
        )}
        <Link
          href="/settings"
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
            pathname === "/settings"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
        >
          <Settings size={14} className="shrink-0" />
          系統設定
        </Link>
        {isApprover && (
          <Link
            href="/approvals"
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              pathname === "/approvals"
                ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            <ClipboardCheck size={14} className="shrink-0" />
            待我審核
          </Link>
        )}
        <Link
          href="/reports/weekly"
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
            pathname === "/reports/weekly"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
        >
          <FileText size={14} className="shrink-0" />
          週報
        </Link>
        <Link
          href="/updates"
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
            pathname === "/updates"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
        >
          <History size={14} className="shrink-0" />
          更新記錄
        </Link>
        <Link
          href="/timesheet"
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
            pathname === "/timesheet"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
        >
          <Clock size={14} className="shrink-0" />
          工時
        </Link>
        <Link
          href="/data-export"
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
            pathname === "/data-export"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
        >
          <DatabaseBackup size={14} className="shrink-0" />
          資料備份
        </Link>
        {userRole === "ADMIN" && (
          <Link
            href="/audit"
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              pathname === "/audit"
                ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            <ScrollText size={14} className="shrink-0" />
            稽核軌跡
          </Link>
        )}
        {canManageStructure(userRole) && (
          <button
            type="button"
            onClick={() => setBoardTrashOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Trash2 size={14} className="shrink-0" />
            看板垃圾桶
          </button>
        )}
        {userRole === "ADMIN" && (
          <Link
            href="/group-roles"
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              pathname === "/group-roles"
                ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            <Shield size={14} className="shrink-0" />
            分組角色設定
          </Link>
        )}
        {programs.length > 0 && (
          <p className="px-2 pb-0.5 pt-3 text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            專案群組
          </p>
        )}
        <SortableList items={programList} onReorder={(ids) => void handleReorder("program", ids)} disabled={impersonating}>
          {(program) => (
          <Link
            href={`/programs/${program.id}`}
            draggable={false}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              pathname === `/programs/${program.id}`
                ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            <FolderKanban size={14} className="shrink-0" />
            <span className="truncate">{program.name}</span>
            <span className="ml-auto shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
              {program.boardCount}
            </span>
          </Link>
          )}
        </SortableList>
        {programs.length > 0 && (
          <p className="px-2 pb-0.5 pt-3 text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            看板
          </p>
        )}
        <SortableList items={boardList} onReorder={(ids) => void handleReorder("board", ids)} disabled={impersonating}>
          {(board) => {
          const active = pathname === `/boards/${board.id}`;
          const admin = openBoardAdmin?.boardId === board.id ? openBoardAdmin : null;
          const canManageBoardRow = canManageThisBoard(board);
          return (
            <div
              className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                active
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  : "text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              <Link
                href={`/boards/${board.id}`}
                draggable={false}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <LayoutGrid size={14} className="shrink-0" />
                <span className="truncate">{board.name}</span>
              </Link>
              {(canManageBoardRow || allowedAdminActions.size > 0) && (
                <RowMenu>
                  {ADMIN_ACTIONS.filter((a) => allowedAdminActions.has(a.id)).map(
                    ({ id, label, Icon }) => (
                      <RowMenuItem
                        key={id}
                        onSelect={() => {
                          // 這塊看板剛好正在開著,直接觸發就好,不用整頁導航。
                          // 不是的話(常見:在別的看板或儀表板點這裡),先導去
                          // 那塊看板,它掛載之後自己讀 openAction 開對話框——
                          // 不然這個選項會因為看板沒開著而在畫面上直接消失,
                          // 看起來像沒有權限,其實只是還沒打開那塊看板。
                          if (admin?.boardId === board.id) admin.open(id);
                          else router.push(`/boards/${board.id}?openAction=${id}`);
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Icon size={14} /> {label}
                        </span>
                      </RowMenuItem>
                    )
                  )}
                  {canManageBoardRow && (
                    <RowMenuItem
                      onSelect={() => {
                        setRenameTarget(board);
                        setRenameValue(board.name);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <Pencil size={14} /> 重新命名
                      </span>
                    </RowMenuItem>
                  )}
                  {canManageBoardRow && (
                    <RowMenuItem danger onSelect={() => handleDelete(board)}>
                      <span className="flex items-center gap-2">
                        <Trash2 size={14} /> 刪除
                      </span>
                    </RowMenuItem>
                  )}
                </RowMenu>
              )}
            </div>
          );
          }}
        </SortableList>
        {boards.length === 0 && (
          <p className="px-2 py-2 text-xs text-neutral-400 dark:text-neutral-500">尚無看板</p>
        )}
      </nav>

      <div className="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            title="個人資料、照片、密碼"
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:ring-1 focus:ring-blue-400"
          >
            <Avatar name={userName} avatarUrl={avatarUrl} size={22} />
            <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">{userName}</span>
          </button>
          <NotificationBell />
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-100"
          >
            登出
          </button>
        </form>
      </div>
      <ProfileModal
        userName={userName}
        avatarUrl={avatarUrl ?? null}
        isAdmin={userRole === "ADMIN"}
        impersonating={impersonating}
        open={profileOpen}
        onOpenChange={setProfileOpen}
      />
      <BoardTrashModal
        open={boardTrashOpen}
        onOpenChange={setBoardTrashOpen}
        canPurge={userRole === "ADMIN"}
      />

      <div
        onPointerDown={startResize}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-blue-400"
        style={{ touchAction: "none" }}
      />

      <Modal open={createOpen} onOpenChange={setCreateOpen} title="新增看板">
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="看板名稱"
          className="mb-4 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button
          type="button"
          disabled={isPending}
          onClick={handleCreate}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          建立
        </button>
      </Modal>

      <Modal
        open={!!renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        title="重新命名看板"
      >
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleRename()}
          className="mb-4 w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button
          type="button"
          disabled={isPending}
          onClick={handleRename}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          儲存
        </button>
      </Modal>
      </div>
    </>
  );
}

/** The bar that replaces the sidebar below md: a hamburger and the app's
 *  name, fixed to the top so it survives the page's own scrolling. */
function MobileBar({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 md:hidden">
      <button
        type="button"
        onClick={onOpen}
        className="rounded p-1.5 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        aria-label="開啟選單"
      >
        <Menu size={18} />
      </button>
      <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">工作管理平台</span>
    </div>
  );
}
