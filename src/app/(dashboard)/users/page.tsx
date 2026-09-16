import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { listUsers } from "@/lib/actions/user";
import { listResources } from "@/lib/actions/resource";
import { UserManagement } from "@/components/users/UserManagement";
import { loadOrgUnits } from "@/lib/orgUnitsServer";
import { ResourceManagement } from "@/components/resources/ResourceManagement";
import { LeaveManagement } from "@/components/users/LeaveManagement";
import { listLeaves } from "@/lib/actions/leave";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    redirect("/boards");
  }
  const { tab } = await searchParams;
  const activeTab = tab === "resources" ? "resources" : tab === "leave" ? "leave" : "users";

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">使用者管理</h1>
      <div className="mb-4 flex w-fit overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 text-sm">
        <Link
          href="/users"
          className={`px-4 py-1.5 ${
            activeTab === "users"
              ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
              : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          }`}
        >
          使用者
        </Link>
        <Link
          href="/users?tab=leave"
          className={`px-4 py-1.5 ${
            activeTab === "leave"
              ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
              : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          }`}
        >
          休假
        </Link>
        <Link
          href="/users?tab=resources"
          className={`px-4 py-1.5 ${
            activeTab === "resources"
              ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
              : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          }`}
        >
          資源
        </Link>
      </div>
      {activeTab === "users" ? (
        <UserManagement
          users={await listUsers()}
          units={await loadOrgUnits()}
          currentUserId={session.userId}
        />
      ) : activeTab === "leave" ? (
        <LeaveManagement
          initialLeaves={await listLeaves()}
          users={await prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })}
          currentUserId={session.userId}
          isAdmin={session.role === "ADMIN"}
        />
      ) : (
        <ResourceManagement
          resources={await listResources()}
          users={await prisma.user.findMany({
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })}
        />
      )}
    </div>
  );
}
