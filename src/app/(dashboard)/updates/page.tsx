import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadUpdateFeed } from "@/lib/updateFeed";
import { UpdateFeed } from "@/components/updates/UpdateFeed";

export default async function UpdatesPage() {
  const session = await requireSession();
  const [rows, users] = await Promise.all([
    loadUpdateFeed(session),
    // 項目詳細資訊的人員選單、任務派遣人等要用。
    prisma.user.findMany({
      select: { id: true, name: true, supervisorId: true, avatarUrl: true, discipline: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">更新記錄</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        工作項的更新與變化,以及風險、議題的新增、指派、變更,新的在前。預設只看「與我有關」的:我做的、指派給我的工作項、我負責或審核的風險與議題;
        按「全部」可以看整個看板上所有人發生的事。跟通知不同的是,通知只在「被指派、被提到」那一刻提醒你。
        點一筆就地跳出那個工作項的詳細資訊(留言跳「更新」分頁,狀態與欄位修改跳「項目卡片」並標出改到的欄位),風險與議題跳到那個看板的風險分頁。
      </p>
      <UpdateFeed rows={rows} users={users} currentUserId={session.userId} userRole={session.role} />
    </div>
  );
}
