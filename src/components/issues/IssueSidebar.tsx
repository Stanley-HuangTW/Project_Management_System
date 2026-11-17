"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FolderKanban, LifeBuoy, ListChecks, Plus, Settings2, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ProfileModal } from "@/components/sidebar/ProfileModal";
import { logout } from "@/lib/actions/auth";
import { ISSUE_ROLE_LABELS, type IssueRole } from "@/lib/issueAccess";

const NAV = [
  { href: "/issues", label: "案件列表", Icon: ListChecks, exact: true },
  { href: "/issues/new", label: "回報新案件", Icon: Plus, exact: true },
  { href: "/issues?mine=1", label: "我的案件", Icon: UserRound, exact: false, key: "mine" },
  { href: "/issues/stats", label: "各產品統整", Icon: BarChart3, exact: false },
] as const;

/** ISSUE TRACKER 的側邊欄:導覽、使用者選單(個人資料、切換到專案管理系統、登出)。手機版變成上方一列。 */
export function IssueSidebar({
  userName,
  isAdmin,
  issueRole,
  avatarUrl,
  impersonating,
  canSwitchToPm,
}: {
  userName: string;
  isAdmin: boolean;
  issueRole: IssueRole;
  avatarUrl: string | null;
  impersonating: boolean;
  canSwitchToPm: boolean;
}) {
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);
  const isManager = issueRole === "MANAGER";

  const link = (active: boolean) =>
    `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm ${
      active
        ? "bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
        : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
    }`;

  return (
    <aside className="flex shrink-0 flex-col border-b border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900 md:w-56 md:border-b-0 md:border-r">
      <div className="flex items-center gap-2 px-4 py-3">
        <LifeBuoy size={18} className="text-emerald-600" />
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">ISSUE TRACKER</span>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:overflow-visible" data-testid="issue-nav">
        {NAV.map((n) => {
          const active = "key" in n ? false : n.exact ? pathname === n.href : pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={link(active)}>
              <n.Icon size={15} /> <span className="whitespace-nowrap">{n.label}</span>
            </Link>
          );
        })}
        {isManager && (
          <Link href="/issues/admin" className={link(pathname.startsWith("/issues/admin"))} data-testid="issue-admin-link">
            <Settings2 size={15} /> <span className="whitespace-nowrap">選項管理 / 匯入</span>
          </Link>
        )}
      </nav>

      <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-700">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            title="個人資料、照片、密碼"
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 outline-none hover:bg-neutral-100 focus:ring-1 focus:ring-blue-400 dark:hover:bg-neutral-800"
          >
            <Avatar name={userName} avatarUrl={avatarUrl} size={22} />
            <span className="min-w-0 truncate text-left text-xs text-neutral-500 dark:text-neutral-400">
              {userName}
              <span className="block text-[10px] text-neutral-400">{isAdmin ? "管理者" : ISSUE_ROLE_LABELS[issueRole]}</span>
            </span>
          </button>
          <NotificationBell />
        </div>
        {canSwitchToPm && (
          <Link
            href="/boards"
            data-testid="switch-to-pm"
            className="mb-2 flex items-center gap-1.5 rounded px-1 py-0.5 text-xs font-medium text-blue-700 hover:bg-neutral-100 dark:text-blue-400 dark:hover:bg-neutral-800"
          >
            <FolderKanban size={13} /> 切換到專案管理系統
          </Link>
        )}
        <form action={logout}>
          <button type="submit" className="text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100">
            登出
          </button>
        </form>
      </div>
      <ProfileModal userName={userName} avatarUrl={avatarUrl} isAdmin={isAdmin} impersonating={impersonating} open={profileOpen} onOpenChange={setProfileOpen} />
    </aside>
  );
}
