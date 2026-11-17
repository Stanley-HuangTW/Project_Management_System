import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderKanban, LifeBuoy } from "lucide-react";
import { requireSession } from "@/lib/session";
import { loadSystemAccess } from "@/lib/issueServer";
import { postLoginPath } from "@/lib/issueAccess";
import { logout } from "@/lib/actions/auth";

/** 登入後選要進哪個系統(兩個都能進的人才會看到)。進去之後可以從使用者選單切換。 */
export default async function SelectSystemPage() {
  const session = await requireSession();
  const access = await loadSystemAccess(session);
  if (!(access.pm && access.issues)) redirect(postLoginPath(access));

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-800 p-6">
      <div className="w-full max-w-2xl">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-100">選擇要進入的系統</h1>
        <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
          {session.name},你可以使用以下兩個系統。進去之後,隨時可以從左下角的使用者選單切換。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/boards"
            data-testid="enter-pm"
            className="group rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm hover:border-blue-500"
          >
            <FolderKanban className="mb-3 text-blue-600" size={28} />
            <div className="text-base font-semibold text-neutral-900 dark:text-neutral-100">專案管理系統</div>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">看板、甘特圖、工時、預算、週報。</p>
          </Link>
          <Link
            href="/issues"
            data-testid="enter-issues"
            className="group rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm hover:border-blue-500"
          >
            <LifeBuoy className="mb-3 text-emerald-600" size={28} />
            <div className="text-base font-semibold text-neutral-900 dark:text-neutral-100">ISSUE TRACKER</div>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">客服維修與問題回報、歸屬、解決方案、進度與統整。</p>
          </Link>
        </div>
        <form action={logout} className="mt-6">
          <button type="submit" className="text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-100">
            登出
          </button>
        </form>
      </div>
    </div>
  );
}
