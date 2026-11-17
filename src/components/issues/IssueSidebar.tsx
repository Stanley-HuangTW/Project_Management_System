"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, ChevronDown, ChevronRight, Clock, FolderKanban, LifeBuoy, ListChecks, Network, Plus, ScrollText, Settings, Settings2, Users, UserRound } from "lucide-react";
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
  { href: "/issues/timesheet", label: "工時", Icon: Clock, exact: false },
] as const;

/** ISSUE TRACKER 的側邊欄:導覽、使用者選單(個人資料、切換到專案管理系統、登出)。手機版變成上方一列。 */
export function IssueSidebar({
  userName,
  isAdmin,
  issueRole,
  avatarUrl,
  impersonating,
  canSwitchToPm,
  feedbackOpen = 0,
}: {
  userName: string;
  isAdmin: boolean;
  issueRole: IssueRole;
  avatarUrl: string | null;
  impersonating: boolean;
  canSwitchToPm: boolean;
  /** 管理者:還沒處理的使用者回報有幾則。 */
  feedbackOpen?: number;
}) {
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);
  const isManager = issueRole === "MANAGER";
  // 「系統設定」群組:使用者管理(管理者)、組織架構圖(大家)、ISSUE TRACKER 設定(管理者)。
  const settingsPaths = ["/issues/users", "/issues/org-chart", "/issues/settings"];
  const inSettings = settingsPaths.some((p) => pathname.startsWith(p));
  const [settingsOpen, setSettingsOpen] = useState(inSettings);

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
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          data-testid="issue-settings-group"
          className={`${link(false)} w-full justify-start`}
          aria-expanded={settingsOpen || inSettings}
        >
          <Settings size={15} /> <span className="whitespace-nowrap">系統設定</span>
          {settingsOpen || inSettings ? <ChevronDown size={13} className="ml-auto" /> : <ChevronRight size={13} className="ml-auto" />}
        </button>
        {(settingsOpen || inSettings) && (
          <div className="ml-4 flex gap-1 border-neutral-200 md:flex-col md:border-l md:pl-1.5 dark:border-neutral-700">
            {isAdmin && (
              <Link href="/issues/users" className={link(pathname.startsWith("/issues/users"))} data-testid="issue-users-link">
                <Users size={14} /> <span className="whitespace-nowrap">使用者管理</span>
              </Link>
            )}
            <Link href="/issues/org-chart" className={link(pathname.startsWith("/issues/org-chart"))} data-testid="issue-orgchart-link">
              <Network size={14} /> <span className="whitespace-nowrap">組織架構圖</span>
            </Link>
            {isManager && (
              <Link href="/issues/settings" className={link(pathname.startsWith("/issues/settings"))} data-testid="issue-settings-link">
                <Settings2 size={14} /> <span className="whitespace-nowrap">ISSUE TRACKER 設定</span>
              </Link>
            )}
          </div>
        )}
        {isManager && (
          <Link href="/issues/admin" className={link(pathname.startsWith("/issues/admin"))} data-testid="issue-admin-link">
            <Settings2 size={15} /> <span className="whitespace-nowrap">選項管理 / 匯入</span>
          </Link>
        )}
        {isAdmin && (
          <Link href="/issues/feedback" className={link(pathname.startsWith("/issues/feedback"))} data-testid="issue-feedback-link">
            <ScrollText size={15} /> <span className="whitespace-nowrap">使用者回報</span>
            {feedbackOpen > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] font-medium text-white">{feedbackOpen}</span>}
          </Link>
        )}
        <Link href="/issues/manual" className={link(pathname.startsWith("/issues/manual"))} data-testid="issue-manual-link">
          <BookOpen size={15} /> <span className="whitespace-nowrap">使用手冊</span>
        </Link>
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
