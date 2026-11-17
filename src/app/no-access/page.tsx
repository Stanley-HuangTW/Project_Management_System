import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { loadSystemAccess } from "@/lib/issueServer";
import { postLoginPath } from "@/lib/issueAccess";
import { logout } from "@/lib/actions/auth";

/** 帳號沒有被授權任何系統時的頁面。 */
export default async function NoAccessPage() {
  const session = await requireSession();
  const access = await loadSystemAccess(session);
  const target = postLoginPath(access);
  if (target !== "/no-access") redirect(target);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-800 p-6">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-8 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">尚未被授權任何系統</h1>
        <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
          {session.name},你的帳號目前沒有專案管理系統或 ISSUE TRACKER 的使用權限,請洽管理者開通。
        </p>
        <form action={logout}>
          <button type="submit" className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            登出
          </button>
        </form>
      </div>
    </div>
  );
}
